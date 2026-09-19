import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Upload, Users, LogOut, Copy, PlusCircle, FolderOpen, ChartLine, ArrowLeft, Trash2, Edit, User, Radio, School, LayoutDashboard, MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CreateTestWizard } from "@/components/teacher/CreateTestWizard";
import { TestEditor } from "@/components/teacher/TestEditor";
import { TestResultsPage } from "@/components/teacher/TestResultsPage";
import { StudentDetailPage } from "@/components/teacher/StudentDetailPage";
import { ClassDetailPage } from "@/components/teacher/ClassDetailPage";
import { LiveSessionsMonitor } from "@/components/teacher/LiveSessionsMonitor";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import sckoolLogo from "@/assets/sckool-logo.jpeg";
import { InfoButton } from "@/components/ui/info-button";

type ActiveSection = "home" | "create" | "tests" | "students" | "classes" | "test-results" | "student-detail" | "monitoring";
const NewTeacherDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, profile, signOut, loading } = useAuth();
  const [tests, setTests] = useState<any[]>([]);
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({});
  const [allResults, setAllResults] = useState<any[]>([]);
  const [activeSection, setActiveSection] = useState<ActiveSection>("home");
  const [editingQuestionsTestId, setEditingQuestionsTestId] = useState<string | null>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [selectedTestTitle, setSelectedTestTitle] = useState<string>('');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selectedStudentName, setSelectedStudentName] = useState<string>('');
  const [activeSessionsCount, setActiveSessionsCount] = useState(0);

  useEffect(() => {
    if (!loading && user) {
      fetchTests();
      fetchResults();
      fetchStudents();
      fetchActiveSessionsCount();
    }
  }, [user, loading]);

  const fetchActiveSessionsCount = async () => {
    if (!user) return;
    try {
      const { data: teacherTests } = await supabase
        .from('tests')
        .select('id')
        .eq('teacher_id', user.id);
      
      if (!teacherTests?.length) {
        setActiveSessionsCount(0);
        return;
      }
      
      const testIds = teacherTests.map(t => t.id);
      
      // Active = any session row exists for the teacher's tests (sessions are deleted on submit)
      const { count } = await supabase
        .from('test_sessions')
        .select('*', { count: 'exact', head: true })
        .in('test_id', testIds);
      
      setActiveSessionsCount(count || 0);
    } catch (error) {
      console.error('Error fetching active sessions count:', error);
    }
  };

  // Realtime subscription so the active count updates live
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('teacher-active-sessions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'test_sessions' }, () => {
        fetchActiveSessionsCount();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);


  const fetchTests = async () => {
    if (!user) return;
    const { data, error } = await supabase.from('tests').select('*').eq('teacher_id', user.id).order('created_at', { ascending: false });
    if (error) {
      console.error('Error fetching tests:', error);
      toast({ title: "Error", description: "Failed to load tests", variant: "destructive" });
    } else {
      setTests(data || []);
      // Fetch question counts in parallel for draft detection
      const ids = (data || []).map(t => t.id);
      if (ids.length > 0) {
        const counts: Record<string, number> = {};
        await Promise.all(ids.map(async (id) => {
          const { count } = await supabase
            .from('questions')
            .select('id', { count: 'exact', head: true })
            .eq('test_id', id);
          counts[id] = count || 0;
        }));
        setQuestionCounts(counts);
      }
    }
  };

  const fetchResults = async () => {
    if (!user) return;
    const { data, error } = await supabase.from('test_results').select(`
        *,
        tests!inner(teacher_id)
      `).eq('tests.teacher_id', user.id).eq('is_retake', false);
    if (error) {
      console.error('Error fetching results:', error);
    } else {
      setAllResults(data || []);
    }
  };

  const fetchStudents = async () => {
    const { data, error } = await supabase.from('profiles').select('*');
    if (!error && data) {
      setStudents(data);
    }
  };

  const handleLogout = async () => {
    await signOut();
    toast({ title: "Logged out", description: "See you next time!" });
  };

  const copyTestCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({ title: "Copied!", description: "Test code copied to clipboard" });
  };

  const handleDeleteTest = async (testId: string) => {
    if (!window.confirm('Are you sure you want to delete this test? This action cannot be undone.')) {
      return;
    }
    const { error } = await supabase.from('tests').delete().eq('id', testId);
    if (error) {
      toast({ title: "Error", description: "Failed to delete test", variant: "destructive" });
    } else {
      setTests(tests.filter(t => t.id !== testId));
      toast({ title: "Test Deleted", description: "Test and all its questions have been deleted" });
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>;
  }
  if (!user) return null;

  // Analytics calculations — memoized so they only recompute when inputs change
  const studentsById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const s of students) m[s.user_id] = s;
    return m;
  }, [students]);

  const {
    avgScore,
    studentCount,
    genderPerformance,
    classPerformance,
    performanceTrend,
    difficultyDistribution,
    hostedTestIds,
  } = useMemo(() => {
    const avg = allResults.length > 0
      ? (allResults.reduce((sum, r) => sum + (r.score || 0), 0) / allResults.length).toFixed(1)
      : 0;

    const genderAcc: Record<string, { total: number; count: number }> = {};
    const classAcc: Record<string, { total: number; count: number }> = {};
    const diffAcc: Record<string, number> = {};
    const studentSet = new Set<string>();
    const hosted = new Set<string>();

    for (const r of allResults) {
      studentSet.add(r.student_id);
      hosted.add(r.test_id);
      const student = studentsById[r.student_id];
      const gender = student?.gender || 'Unknown';
      const className = student ? `${student.grade}-${student.class}` : 'Unknown';
      const diff = r.difficulty_level || 'Unknown';
      (genderAcc[gender] ??= { total: 0, count: 0 }).total += r.score || 0;
      genderAcc[gender].count += 1;
      (classAcc[className] ??= { total: 0, count: 0 }).total += r.score || 0;
      classAcc[className].count += 1;
      diffAcc[diff] = (diffAcc[diff] || 0) + 1;
    }

    const trend = [...allResults]
      .sort((a, b) => new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime())
      .slice(-10)
      .map((r, i) => {
        const student = studentsById[r.student_id];
        return {
          test: student?.full_name?.split(' ')[0] || `S${i + 1}`,
          score: r.score || 0,
          fullName: student?.full_name || 'Unknown',
        };
      });

    return {
      avgScore: avg,
      studentCount: studentSet.size,
      genderPerformance: Object.entries(genderAcc).map(([gender, d]) => ({ gender, avgScore: parseFloat((d.total / d.count).toFixed(1)) })),
      classPerformance: Object.entries(classAcc).map(([name, d]) => ({ name, avgScore: parseFloat((d.total / d.count).toFixed(1)) })),
      performanceTrend: trend,
      difficultyDistribution: Object.entries(diffAcc).map(([name, value]) => ({ name, value })),
      hostedTestIds: hosted,
    };
  }, [allResults, studentsById]);

  // Render section content
  const renderSection = () => {
    switch (activeSection) {
      case "create":
        return <CreateTestWizard teacherId={user.id} onComplete={testCode => {
          fetchTests();
          setActiveSection("tests");
        }} onCancel={() => setActiveSection("home")} />;
      case "tests":
        if (editingQuestionsTestId) {
          return <TestEditor testId={editingQuestionsTestId} onClose={() => {
            setEditingQuestionsTestId(null);
            fetchTests();
          }} />;
        }
        return <section className="animate-fade-in">
            <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
              <div>
                <h3 className="text-xl font-semibold mb-1">My Tests</h3>
                <p className="text-muted-foreground text-sm">Create, manage, and review analytics for your tests</p>
              </div>
              <Button
                onClick={() => setActiveSection("create")}
                className="gap-2 rounded-xl h-11 px-5"
              >
                <PlusCircle className="h-4 w-4" />
                Create New Test
              </Button>
            </div>

            <div className="space-y-4">
               {tests.length === 0 ? (
                  <div className="text-center py-16 border border-dashed border-border rounded-lg bg-card/40">
                   <FolderOpen className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
                   <p className="text-muted-foreground">No tests created yet.</p>
                   <p className="text-xs text-muted-foreground mt-1">Click "Create New Test" to get started.</p>
                 </div>
               ) : tests.map((test) => {
                 const testResults = allResults.filter(r => r.test_id === test.id);
                 const attemptCount = testResults.length;
                 const avgTestScore = attemptCount > 0
                   ? Math.round((testResults.reduce((sum, r) => sum + (r.score || 0), 0) / attemptCount) * 10) / 10
                   : null;
                 const avgTimeMinutes = attemptCount > 0
                   ? Math.round(testResults.reduce((sum, r) => sum + (r.time_spent || 0), 0) / attemptCount / 60)
                   : 0;
                 const isHosted = attemptCount > 0;
                 const qCount = questionCounts[test.id] ?? 0;
                 const isDraft = !isHosted && qCount === 0;

                 return (
                   <div
                     key={test.id}
                      className="p-5 bg-card border border-border/60 rounded-lg hover:border-primary/40 hover:shadow-sm transition-all"
                   >
                     {/* Header row */}
                     <div className="flex items-start justify-between gap-4 mb-4">
                       <div className="flex-1 min-w-0">
                         <div className="flex items-center gap-2 mb-1 flex-wrap">
                           <h4 className="font-semibold text-foreground text-lg truncate">{test.title}</h4>
                           {isHosted && (
                             <Badge className="bg-secondary text-secondary-foreground hover:bg-secondary/90 rounded-full text-[10px] uppercase tracking-wide">
                               Hosted
                             </Badge>
                           )}
                           {isDraft && (
                             <Badge variant="outline" className="border-accent text-accent rounded-full text-[10px] uppercase tracking-wide">
                               Draft
                             </Badge>
                           )}
                         </div>
                         {test.description && (
                           <p className="text-sm text-muted-foreground line-clamp-1">{test.description}</p>
                         )}
                         <p className="text-xs text-muted-foreground mt-1">
                           {test.subject} • {test.duration_minutes || 60} min
                           {test.target_grade ? ` • ${test.target_grade}${test.target_section ? '-' + test.target_section : ''}` : ''}
                           {' • '}{new Date(test.created_at).toLocaleDateString()}
                         </p>
                       </div>
                       <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right px-3 py-1.5 rounded-md bg-primary/5 border border-primary/10">
                           <p className="text-base font-bold text-primary font-mono leading-tight">{test.test_code}</p>
                           <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Test Code</p>
                         </div>
                          <Button variant="ghost" size="icon" onClick={() => copyTestCode(test.test_code)} className="rounded-md" title="Copy test code" aria-label={`Copy code for ${test.title}`}>
                           <Copy className="h-4 w-4" />
                         </Button>
                       </div>
                     </div>

                     {/* Stats strip */}
                     <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="p-3 bg-muted/40 rounded-md">
                         <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg Score</p>
                         <p className="text-lg font-semibold text-foreground">
                           {avgTestScore !== null ? `${avgTestScore}%` : '—'}
                         </p>
                       </div>
                        <div className="p-3 bg-muted/40 rounded-md">
                         <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Attempts</p>
                         <p className="text-lg font-semibold text-foreground">{attemptCount}</p>
                       </div>
                        <div className="p-3 bg-muted/40 rounded-md">
                         <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg Time</p>
                         <p className="text-lg font-semibold text-foreground">
                           {attemptCount > 0 ? `${avgTimeMinutes} min` : '—'}
                         </p>
                       </div>
                     </div>

                     {/* Action row */}
                      <div className="flex items-center justify-end gap-2">
                       <Button
                         size="sm"
                         onClick={() => setEditingQuestionsTestId(test.id)}
                          className="rounded-md gap-2"
                       >
                         <Edit className="h-4 w-4" />
                         Edit
                       </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" className="h-9 w-9 rounded-md" aria-label={`More actions for ${test.title}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              disabled={!isHosted}
                              onClick={() => {
                                setSelectedTestId(test.id);
                                setSelectedTestTitle(test.title);
                                setActiveSection("test-results");
                              }}
                            >
                              <ChartLine className="mr-2 h-4 w-4" />
                              View results
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => copyTestCode(test.test_code)}>
                              <Copy className="mr-2 h-4 w-4" />
                              Copy test code
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleDeleteTest(test.id)} className="text-destructive focus:text-destructive">
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete test
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                     </div>
                   </div>
                 );
               })}
            </div>
           </section>;
      // analytics merged into "tests" tab — no standalone analytics view
      case "students":
        // Group results by student
        const studentMap = new Map<string, { student: any; results: any[] }>();
        allResults.forEach(result => {
          const student = students.find(s => s.user_id === result.student_id);
          if (!studentMap.has(result.student_id)) {
            studentMap.set(result.student_id, { student, results: [] });
          }
          studentMap.get(result.student_id)!.results.push(result);
        });
        
        const studentsList = Array.from(studentMap.entries()).map(([id, data]) => ({
          id,
          name: data.student?.full_name || 'Unknown Student',
          grade: data.student?.grade,
          class: data.student?.class,
          testsCompleted: data.results.length,
          avgScore: Math.round(data.results.reduce((sum, r) => sum + (r.score || 0), 0) / data.results.length),
          lastTest: data.results.sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())[0]
        }));

        return <section className="animate-fade-in">
            <h3 className="text-xl font-semibold mb-2">Students</h3>
            <p className="text-muted-foreground text-sm mb-6">View detailed individual student performance</p>
            <div className="space-y-4">
              {studentsList.length === 0 ? <p className="text-muted-foreground text-center py-12">No student results yet</p> : studentsList.map((studentData, idx) => {
              return <div 
                key={idx} 
                 className="p-5 bg-card border border-border/60 rounded-lg hover:border-primary/40 hover:bg-muted/20 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                 role="button"
                 tabIndex={0}
                onClick={() => {
                  setSelectedStudentId(studentData.id);
                  setSelectedStudentName(studentData.name);
                  setActiveSection("student-detail");
                 }}
                 onKeyDown={(event) => {
                   if (event.key === 'Enter' || event.key === ' ') {
                     event.preventDefault();
                     setSelectedStudentId(studentData.id);
                     setSelectedStudentName(studentData.name);
                     setActiveSection("student-detail");
                   }
                 }}
              >
                      <div className="flex justify-between items-center">
                         <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                            <User className="h-6 w-6 text-primary" />
                          </div>
                          <div>
                            <p className="font-semibold text-foreground">{studentData.name}</p>
                            <p className="text-sm text-muted-foreground mt-1">
                              {studentData.grade} - {studentData.class} • {studentData.testsCompleted} tests completed
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-2xl font-bold text-primary">{studentData.avgScore}%</p>
                            <p className="text-xs text-muted-foreground">Avg Score</p>
                          </div>
                        </div>
                      </div>
                    </div>;
            })}
            </div>
          </section>;
      case "test-results":
        if (!selectedTestId) return null;
        return <TestResultsPage 
          testId={selectedTestId} 
          testTitle={selectedTestTitle}
          onBack={() => setActiveSection("tests")}
        />;
      case "student-detail":
        if (!selectedStudentId) return null;
        return <StudentDetailPage
          studentId={selectedStudentId}
          studentName={selectedStudentName}
          onBack={() => setActiveSection("students")}
        />;
      case "classes":
        return <ClassDetailPage teacherId={user.id} onBack={() => setActiveSection("home")} />;
      case "monitoring":
        return <LiveSessionsMonitor onBack={() => setActiveSection("home")} />;
      default:
        return null;
    }
  };

  const sectionLabels: Record<ActiveSection, string> = {
    home: "Overview",
    create: "Create Test",
    tests: "My Tests",
    students: "Students",
    classes: "Classes",
    "test-results": "Test Results",
    "student-detail": "Student Details",
    monitoring: "Live Monitoring",
  };

  const navigationItems = [
    { id: "home" as const, label: "Overview", icon: LayoutDashboard },
    { id: "tests" as const, label: "Tests", icon: FolderOpen },
    { id: "students" as const, label: "Students", icon: Users },
    { id: "classes" as const, label: "Classes", icon: School },
    { id: "monitoring" as const, label: "Live", icon: Radio },
  ];

  const showPrimaryNavigation = !["create", "test-results", "student-detail"].includes(activeSection) && !editingQuestionsTestId;
  const showGlobalBack = activeSection === "create" || Boolean(editingQuestionsTestId);

  return <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-5 md:px-6 md:py-7 max-w-6xl">
        {/* Header */}
        <header className="flex justify-between items-center mb-5 border-b border-border pb-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full overflow-hidden shadow-md border-2 border-primary/20">
              <img src={sckoolLogo} alt="Sckool Logo" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{sectionLabels[activeSection]}</h1>
              <p className="text-sm text-muted-foreground">{profile?.full_name || 'Teacher'}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={handleLogout} className="rounded-md" aria-label="Log out" title="Log out">
            <LogOut className="h-4 w-4" />
          </Button>
        </header>

        {showPrimaryNavigation && (
          <nav className="mb-8 flex items-center gap-1 overflow-x-auto border-b border-border" aria-label="Teacher workspace">
            {navigationItems.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant="ghost"
                size="sm"
                onClick={() => setActiveSection(id)}
                className={`relative shrink-0 rounded-none border-b-2 px-3 pb-3 pt-2 ${activeSection === id ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-muted-foreground'}`}
              >
                <Icon className="h-4 w-4" />
                {label}
                {id === 'monitoring' && activeSessionsCount > 0 && (
                  <Badge className="ml-1 h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px]">{activeSessionsCount}</Badge>
                )}
              </Button>
            ))}
            <div className="ml-auto pl-3 pb-2">
              <Button size="sm" onClick={() => setActiveSection("create")} className="rounded-md gap-2">
                <PlusCircle className="h-4 w-4" />
                Create test
              </Button>
            </div>
          </nav>
        )}

        {/* Back button when in a section */}
        {showGlobalBack && <Button variant="ghost" size="sm" onClick={() => {
          if (editingQuestionsTestId) {
            setEditingQuestionsTestId(null);
            fetchTests();
          } else {
            setActiveSection("tests");
          }
        }} className="mb-5 -ml-2 rounded-md text-muted-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back to My Tests
          </Button>}

        {activeSection === "home" ? <>
            {/* Quick Stats */}
            <div className="grid grid-cols-1 divide-y divide-border rounded-lg border border-border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0 mb-8">
              <div className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Upload className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Tests Created</p>
                    <p className="text-2xl font-bold">{tests.length}</p>
                  </div>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-md bg-secondary/10 flex items-center justify-center flex-shrink-0">
                    <Users className="h-5 w-5 text-secondary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Students</p>
                    <p className="text-2xl font-bold">{studentCount}</p>
                  </div>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-md bg-success/10 flex items-center justify-center flex-shrink-0">
                    <Radio className="h-5 w-5 text-success" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Active Sessions</p>
                    <p className="text-2xl font-bold">{activeSessionsCount}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-end justify-between gap-4 mb-4">
              <div>
                <h2 className="text-xl font-semibold">Recent tests</h2>
                <p className="text-sm text-muted-foreground">Continue editing or review your latest assessments.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setActiveSection("tests")} className="rounded-md">View all</Button>
            </div>
            <div className="divide-y divide-border rounded-lg border border-border bg-card">
              {tests.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">No tests created yet.</div>
              ) : tests.slice(0, 5).map(test => (
                <button
                  key={test.id}
                  onClick={() => { setActiveSection("tests"); setEditingQuestionsTestId(test.id); }}
                  className="flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{test.title}</p>
                    <p className="text-xs text-muted-foreground">{test.subject} · {questionCounts[test.id] ?? 0} questions</p>
                  </div>
                  <span className="shrink-0 font-mono text-sm text-primary">{test.test_code}</span>
                </button>
              ))}
            </div>
          </> : renderSection()}
      </div>
      <InfoButton />
    </div>;
};
export default NewTeacherDashboard;
