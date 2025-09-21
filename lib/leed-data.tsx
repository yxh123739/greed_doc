import React from "react";
import {
  Leaf,
  Award,
  TrendingUp,
  Zap,
  Droplets,
  Building,
  Lightbulb,
} from "lucide-react";

export interface Category {
  id: string;
  name: string;
  description: string;
  maxPoints: number;
  levels: string[];
  strategies: string;
  icon: React.ReactNode;
}

// LEED v5 BD+C categories with correct point distribution (110 total points)
export const categories: Category[] = [
  {
    id: "location",
    name: "Location & Transportation",
    description:
      "Walk score, surrounding density, public transit, bicycle facilities, parking, electric vehicle charging",
    maxPoints: 15,
    levels: ["Rural", "Suburban", "Urban", "Dense Urban"],
    strategies: "Optimize site selection",
    icon: <Building className="w-5 h-5" />,
  },
  {
    id: "sites",
    name: "Sustainable Sites",
    description:
      "Habitat protection, stormwater management, heat island reduction, resilient site design",
    maxPoints: 11,
    levels: ["Minimal", "Moderate", "Sustainable", "Regenerative"],
    strategies: "Improve sustainable site design",
    icon: <Leaf className="w-5 h-5" />,
  },
  {
    id: "water",
    name: "Water Efficiency",
    description: "Water conservation, metering, efficient water fixtures",
    maxPoints: 9,
    levels: ["Standard", "Efficient", "Advanced", "Exceptional"],
    strategies: "Enhance water conservation strategies",
    icon: <Droplets className="w-5 h-5" />,
  },
  {
    id: "energy",
    name: "Energy Efficiency",
    description:
      "Renewable energy, efficient envelope and HVAC, commissioning, metering, electrification",
    maxPoints: 33,
    levels: ["Standard", "Efficient", "Advanced", "Net-Zero"],
    strategies: "Improve energy efficiency measures",
    icon: <Zap className="w-5 h-5" />,
  },
  {
    id: "materials",
    name: "Sustainable Materials ",
    description:
      "Recycled content, healthy materials, waste reduction, reduced embodied carbon",
    maxPoints: 18,
    levels: [
      "Convetional",
      "Partially Sustainable",
      "Sustainable",
      "Regenerative",
    ],
    strategies: "Enhance sustainable materials",
    icon: <Award className="w-5 h-5" />,
  },
  {
    id: "indoor",
    name: "Indoor Environmental Quality",
    description:
      "Air quality, biophilic design, daylight & glare control, acoustic, operable windows, thermal comfort",
    maxPoints: 13,
    levels: ["Basic", "Confortable", "Healthy", "Exceptional"],
    strategies: "Improve indoor environmental quality",
    icon: <TrendingUp className="w-5 h-5" />,
  },
  {
    id: "priorities",
    name: "Project Priorities",
    description:
      "Integrative process, innovative design, exemplary performance, LEED AP involvement, regional priority",
    maxPoints: 11,
    levels: ["Standard", "Improved", "Innovative", "Groundbreaking"],
    strategies: "Respond to project and regional priorities",
    icon: <Lightbulb className="w-5 h-5" />,
  },
];
