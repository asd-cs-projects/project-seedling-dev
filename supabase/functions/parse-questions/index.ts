import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ParsedQuestion {
  question_text: string;
  options: string[];
  correct_answer: string;
  marks: number;
  image_description?: string;
  table_description?: string;
  passage_title?: string;
  passage_text?: string;
  passage_id?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { extractedText, difficulty, images = [], tables = [], passages = [] } = await req.json();

    if (!extractedText) {
      return new Response(
        JSON.stringify({ error: 'No text provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'OPENROUTER_API_KEY not configured on server.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const model = Deno.env.get('OPENROUTER_MODEL') || 'google/gemini-2.5-flash';

    const systemPrompt = `You are an expert at parsing educational assessment questions from OCR text.
Your task is to extract multiple-choice questions (MCQs) and properly link them to passages.

CRITICAL RULES:

1. PASSAGE LINKING:
   - If a question has [BELONGS_TO_PASSAGE: Title] marker, include that passage info
   - Set passage_id as a slug of the title (e.g., "passage-a-water-cycle")
   - Include passage_title and passage_text for questions that belong to passages
   - All questions belonging to the same passage should share the same passage_id

2. TABLE HANDLING:
   - If [TABLE_IMAGE_N: description] appears near a question, include table_description
   - Tables should be referenced as images in the quiz display

3. IMAGE HANDLING:
   - If [IMAGE_N: description] appears near a question, include image_description

4. QUESTION EXTRACTION:
   - Extract question text, all options (A, B, C, D), correct answer
   - Default marks to 1 unless specified
   - Clean up any OCR artifacts

Return JSON in this exact format:
{
  "questions": [
    {
      "question_text": "Complete question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_answer": "A",
      "marks": 1,
      "image_description": "Description if image present, null otherwise",
      "table_description": "Description if table present, null otherwise", 
      "passage_id": "passage-slug if belongs to passage, null otherwise",
      "passage_title": "Passage title if applicable",
      "passage_text": "Full passage text if applicable"
    }
  ]
}

IMPORTANT:
- passage_text should only be included ONCE for the first question of each passage
- Subsequent questions in the same passage only need passage_id
- Return ONLY valid JSON, no other text`;

    const passageInfo = passages.length > 0 
      ? `\n\nDetected ${passages.length} passages:\n${passages.map((p: any) => `- "${p.title}"`).join('\n')}`
      : '';

    const requestBody = JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 32000,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: systemPrompt + `\n\nParse the following OCR text and extract all MCQ questions with proper passage linking.${passageInfo}\n\nOCR Text:\n${extractedText}`,
        },
      ],
    });

    let response: Response | null = null;
    let lastErrorText = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: requestBody,
      });

      if (r.ok) { response = r; break; }

      lastErrorText = await r.text();
      console.error(`OpenRouter ${model} attempt ${attempt + 1} failed (${r.status}):`, lastErrorText.substring(0, 200));

      if (r.status === 429 || r.status === 503 || r.status === 500) {
        if (attempt < 2) {
          const backoff = 1000 * Math.pow(2, attempt) + Math.random() * 500;
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
        break;
      }
      throw new Error(`OpenRouter API error: ${r.status} - ${lastErrorText}`);
    }

    if (!response) {
      return new Response(
        JSON.stringify({ error: 'AI service is temporarily overloaded. Please try again in a minute.', details: lastErrorText.substring(0, 300) }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    // OpenRouter response: choices[0].message.content
    const content = data.choices?.[0]?.message?.content || '';

    // Extract JSON from the response (strip code fences if present)
    let parsed: { questions: ParsedQuestion[] };
    try {
      const cleaned = content.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('JSON parse error:', parseError, 'Content:', content);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to parse AI response',
          rawContent: content.substring(0, 500)
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate and clean the parsed questions
    const validQuestions = (parsed.questions || []).filter((q: ParsedQuestion) => 
      q.question_text && 
      Array.isArray(q.options) && 
      q.options.length >= 2 &&
      q.correct_answer
    ).map((q: ParsedQuestion, index: number) => {
      // Limit options to 4 (A, B, C, D only)
      const limitedOptions = q.options.slice(0, 4);
      // Validate correct_answer is A-D
      const validAnswer = q.correct_answer.toUpperCase().charAt(0);
      const correctedAnswer = ['A', 'B', 'C', 'D'].includes(validAnswer) ? validAnswer : 'A';
      
      return {
        ...q,
        options: limitedOptions,
        difficulty: difficulty || 'easy',
        order_index: index,
        marks: q.marks || 1,
        correct_answer: correctedAnswer,
        image_description: q.image_description || null,
        table_description: q.table_description || null,
        passage_id: q.passage_id || null,
        passage_title: q.passage_title || null,
        passage_text: q.passage_text || null,
      };
    });

    console.log(`Parsed ${validQuestions.length} questions. Passages linked: ${validQuestions.filter(q => q.passage_id).length}`);

    return new Response(
      JSON.stringify({ 
        questions: validQuestions,
        totalFound: validQuestions.length,
        imagesDetected: images.length,
        tablesDetected: tables.length,
        passagesDetected: passages.length,
        success: true 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Parse questions error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to parse questions';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
