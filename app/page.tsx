"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Navbar } from "@/components/navbar";
import { HeroSection } from "@/components/hero-section";
import { LEEDAssessment } from "@/components/leed-assessment";
import { Sidebar } from "@/components/sidebar";

import { FeedbackSection } from "@/components/feedback-section";
import { type Category } from "@/lib/leed-data";
import {
  fetchCategories,
  getUser,
  listProjects,
  saveProjectScores,
  loadProjectScores,
  deleteProjectScores,
} from "@/lib/supabase/queries";
import { supabase } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Leaf,
  Award,
  TrendingUp,
  Zap,
  Droplets,
  Building,
  Lightbulb,
} from "lucide-react";

export default function LEEDSurvey() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [email, setEmail] = useState<string | null>(null);
  const [projects, setProjects] = useState<{ name: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [loadingProject, setLoadingProject] = useState(false);

  // Map DB icon_key to lucide-react icon elements
  const iconFor = (key: string) => {
    const map: Record<string, React.ReactNode> = {
      leaf: <Leaf className="w-5 h-5" />,
      award: <Award className="w-5 h-5" />,
      trending_up: <TrendingUp className="w-5 h-5" />,
      zap: <Zap className="w-5 h-5" />,
      droplets: <Droplets className="w-5 h-5" />,
      building: <Building className="w-5 h-5" />,
      lightbulb: <Lightbulb className="w-5 h-5" />,
    };
    return map[key] ?? <Leaf className="w-5 h-5" />;
  };

  useEffect(() => {
    (async () => {
      const db = await fetchCategories();
      const mapped: Category[] = db.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        maxPoints: c.max_points,
        levels: c.levels,
        strategies: c.strategies,
        icon: iconFor(c.icon_key),
      }));
      setCategories(mapped);
      // Initialize scores if empty
      setScores((prev) => {
        if (Object.keys(prev).length) return prev;
        const initial: Record<string, number> = {};
        for (const c of mapped) initial[c.id] = 0;
        return initial;
      });
    })();
  }, []);

  // Separate effect for auth state monitoring
  useEffect(() => {
    let mounted = true;

    // Get initial auth state
    const getInitialAuth = async () => {
      const user = await getUser();
      if (mounted) {
        setEmail(user?.email ?? null);
        if (user) {
          const rows = await listProjects();
          setProjects(rows.map((r) => ({ name: r.name })));
        } else {
          setProjects([]);
          setSelectedProject("");
        }
      }
    };

    getInitialAuth();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      const user = session?.user ?? null;
      setEmail(user?.email ?? null);

      if (user) {
        // User signed in - load their projects
        const rows = await listProjects();
        setProjects(rows.map((r) => ({ name: r.name })));
      } else {
        // User signed out - clear projects and selection
        setProjects([]);
        setSelectedProject("");
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const totalScore = useMemo(() => {
    return Math.round(
      categories.reduce((sum: number, category: Category) => {
        return sum + (scores[category.id] / 100) * category.maxPoints;
      }, 0)
    );
  }, [scores, categories]);

  const certificationLevel = useMemo(() => {
    if (totalScore >= 80)
      return {
        name: "Platinum",
        color: "default",
        range: "80-110",
      };
    if (totalScore >= 60)
      return {
        name: "Gold",
        color: "default",
        range: "60-79",
      };
    if (totalScore >= 50)
      return {
        name: "Silver",
        color: "default",
        range: "50-59",
      };
    if (totalScore >= 40)
      return {
        name: "Certified",
        color: "secondary",
        range: "40-49",
      };
    return {
      name: "Not Certified",
      color: "destructive",
      range: "<40",
    };
  }, [totalScore]);

  const recommendations = useMemo(() => {
    if (totalScore >= 80) {
      return {
        title: "Excellent Work!",
        categories: [],
        message:
          "Your project might achieve Platinum certification. Consider documenting your strategies for future projects.",
        isPlatinum: true,
      };
    }

    const categoriesData = categories
      .filter((category) => category.id !== "location")
      .map((category) => {
        const score = scores[category.id];
        // Create a weighted score for sorting
        // Lower score ranges get higher base values to appear first
        // Within same range, higher maxPoints come first (more impact)
        let sortScore;
        if (score < 50) {
          sortScore = 10000 + category.maxPoints; // 10000+ range, sorted by maxPoints
        } else if (score < 75) {
          sortScore = 5000 + category.maxPoints; // 5000+ range, sorted by maxPoints
        } else {
          sortScore = category.maxPoints; // sorted by maxPoints
        }

        return {
          name: category.name,
          value: score,
          maxPoints: category.maxPoints,
          recommendation: `• ${category.strategies}`,
          percentage: score,
          potentialGain: (100 - score) * (category.maxPoints / 100),
          impactScore: (100 - score) * category.maxPoints,
          sortScore: sortScore,
        };
      });

    const sortedCategories = categoriesData
      .sort((a, b) => b.sortScore - a.sortScore) // Sort by weighted score descending
      .slice(0, 3);

    const title =
      totalScore < 40
        ? "Focus Areas for Certification:"
        : totalScore < 50
        ? "Path to Silver Level:"
        : totalScore < 60
        ? "Path to Gold Level:"
        : "Path to Platinum:";

    return {
      title: title,
      categories: sortedCategories,
      message: "",
      isPlatinum: false,
    };
  }, [scores, totalScore, categories]);

  const updateScore = (categoryId: string, value: number) => {
    setScores((prev) => ({ ...prev, [categoryId]: value }));
  };

  const handleSave = async (projectName: string) => {
    try {
      setSaving(true);
      await saveProjectScores(projectName, scores);
      toast("Project saved successfully");
      const rows = await listProjects();
      setProjects(rows.map((r) => ({ name: r.name })));
      setSelectedProject(projectName);
    } catch (e: any) {
      toast(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleLoad = async (name: string) => {
    try {
      setLoadingProject(true);
      setSelectedProject(name);
      const loaded = await loadProjectScores(name);
      if (loaded) {
        setScores(loaded);
        toast(`Loaded project: ${name}`);
      }
    } catch (e: any) {
      toast(e.message || String(e));
    } finally {
      setLoadingProject(false);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await deleteProjectScores(name);
      toast(`Project "${name}" deleted successfully`);
      const rows = await listProjects();
      setProjects(rows.map((r) => ({ name: r.name })));
      if (selectedProject === name) {
        setSelectedProject("");
      }
    } catch (e: any) {
      toast(e.message || String(e));
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <HeroSection />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
            LEED v5 BD+C Target Finder
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
            Evaluate your project&apos;s potential for LEED v5 certification by
            adjusting the criteria below.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8 items-stretch">
          {categories.length > 0 && !loadingProject ? (
            <LEEDAssessment
              categories={categories}
              scores={scores}
              updateScore={updateScore}
              email={email}
              projects={projects}
              selectedProject={selectedProject}
              saving={saving}
              onSave={handleSave}
              onLoad={handleLoad}
              onDelete={handleDelete}
            />
          ) : (
            <div className="lg:col-span-2">
              <div className="rounded-lg border p-6 space-y-6">
                <div className="space-y-2">
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-4 w-80" />
                </div>
                <div className="space-y-5">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Skeleton className="h-4 w-56" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                      <Skeleton className="h-2 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <Sidebar
            totalScore={totalScore}
            certificationLevel={certificationLevel}
            recommendations={recommendations}
          />
        </div>

        <FeedbackSection />
      </div>

      {/* Copyright Footer */}
      <footer className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="text-center text-sm text-muted-foreground">
            Copyright © 2025 Anchor Sustainability LLC. All Rights Reserved.
          </div>
        </div>
      </footer>

      {/* <FloatingChatButton /> */}
    </div>
  );
}
