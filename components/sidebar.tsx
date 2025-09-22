"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { VariantProps } from "class-variance-authority";

interface CertificationLevel {
  name: string;
  color: string;
  range: string;
}

interface Recommendation {
  title: string;
  categories: Array<{
    name: string;
    value: number;
    maxPoints: number;
    recommendation: string;
    percentage: number;
    potentialGain: number;
    impactScore: number;
  }>;
  message: string;
  isPlatinum: boolean;
}

interface SidebarProps {
  totalScore: number;
  certificationLevel: CertificationLevel;
  recommendations: Recommendation;
}

export function Sidebar({
  totalScore,
  certificationLevel,
  recommendations,
}: SidebarProps) {
  return (
    <div className="h-full flex flex-col gap-6">
      <Card className="flex-1">
        <CardHeader>
          <CardTitle>LEED Certification Target</CardTitle>
          <CardDescription>
            Based on your current project specifications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center space-y-4">
            <div className="space-y-2">
              <div className="text-3xl font-bold text-primary">
                {totalScore}/110
              </div>
              <div className="text-sm text-muted-foreground">
                Estimated LEED Points
              </div>
            </div>

            <Badge
              variant={
                certificationLevel.color as VariantProps<
                  typeof badgeVariants
                >["variant"]
              }
              className="text-lg px-4 py-2"
            >
              {certificationLevel.name}
            </Badge>

            <p className="text-sm text-muted-foreground max-w-sm mx-auto text-left">
              Disclaimer: This assessment evaluates feasibility for LEED credits
              using simplified heuristics. Actual eligibility and certification
              depend on design integration, detailed documentation, and
              USGBC/GBCI review.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Certification Target Levels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            {
              name: "Certified",
              points: "40+ points",
              color: "secondary",
            },
            {
              name: "Silver",
              points: "50+ points",
              color: "default",
            },
            {
              name: "Gold",
              points: "60+ points",
              color: "default",
            },
            {
              name: "Platinum",
              points: "80+ points",
              color: "default",
            },
          ].map((level) => (
            <div
              key={level.name}
              className={`flex items-center justify-between p-3 rounded-lg border border-accent ${
                certificationLevel.name === level.name
                  ? "border-primary bg-primary/5"
                  : ""
              }`}
            >
              <div>
                <div className="font-medium">{level.name}</div>
                <div className="text-sm text-muted-foreground">
                  {level.points} (out of 110)
                </div>
              </div>
              {certificationLevel.name === level.name && (
                <Badge variant="default">Current</Badge>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            {(() => {
              // Platinum level congratulations
              if (recommendations.isPlatinum) {
                return (
                  <div className="p-3 bg-primary/10 rounded-lg border border-primary/20">
                    <p className="font-medium text-primary">
                      {recommendations.title}
                    </p>
                    <p className="mt-2 text-muted-foreground">
                      {recommendations.message}
                    </p>
                  </div>
                );
              }

              const bgColor =
                totalScore < 40
                  ? "bg-destructive/10 border-destructive/20"
                  : totalScore < 50
                  ? "bg-secondary/10 border-secondary/20"
                  : totalScore < 60
                  ? "bg-secondary/10 border-secondary/20"
                  : "bg-accent/10 border-accent/20";

              const titleColor =
                totalScore < 40
                  ? "text-destructive"
                  : totalScore < 50
                  ? ""
                  : totalScore < 60
                  ? ""
                  : "text-accent-foreground";

              return (
                <div className={`p-3 rounded-lg border ${bgColor}`}>
                  <p className={`font-medium ${titleColor}`}>
                    {recommendations.title}
                  </p>
                  <ul className="mt-2 space-y-1 text-muted-foreground">
                    {recommendations.categories.map((cat, index) => (
                      <li key={index}>{cat.recommendation}</li>
                    ))}
                  </ul>
                </div>
              );
            })()}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
