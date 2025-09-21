"use client";

import type React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { ProjectManager } from "@/components/project-manager";

interface Category {
  id: string;
  name: string;
  description: string;
  maxPoints: number;
  levels: string[];
  strategies: string;
  icon: React.ReactNode;
}

interface LEEDAssessmentProps {
  categories: Category[];
  scores: Record<string, number>;
  updateScore: (categoryId: string, value: number) => void;
  email: string | null;
  projects: { name: string }[];
  selectedProject: string;
  saving: boolean;
  onSave: (projectName: string) => Promise<void>;
  onLoad: (projectName: string) => Promise<void>;
}

// Get current level based on slider value and category levels
const getCurrentLevel = (value: number, levels: string[]) => {
  const index = Math.floor((value / 100) * levels.length);
  return levels[Math.min(index, levels.length - 1)];
};

export function LEEDAssessment({
  categories,
  scores,
  updateScore,
  email,
  projects,
  selectedProject,
  saving,
  onSave,
  onLoad,
}: LEEDAssessmentProps) {
  return (
    <div className="lg:col-span-2 flex">
      <Card className="flex-1 h-full">
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle>Project Criteria</CardTitle>
              <CardDescription>
                Adjust the sliders based on your project specifications
              </CardDescription>
            </div>
            <ProjectManager
              email={email}
              projects={projects}
              selectedProject={selectedProject}
              saving={saving}
              onSave={onSave}
              onLoad={onLoad}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {categories.map((category: Category, index: number) => {
            const currentLevel = getCurrentLevel(
              scores[category.id],
              category.levels
            );

            return (
              <div key={category.id}>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="font-medium">{category.name}</label>
                    <div className="text-right">
                      <span className="text-sm font-medium text-primary">
                        {currentLevel}
                      </span>
                    </div>
                  </div>
                  <Slider
                    value={[scores[category.id]]}
                    onValueChange={(value) =>
                      updateScore(category.id, value[0])
                    }
                    max={100}
                    step={1}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    {category.description}
                  </p>
                </div>
                {index < categories.length - 1 && (
                  <Separator className="my-6" />
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
