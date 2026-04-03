"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Lock } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import Link from "next/link";

type BenchmarkTab = "location" | "summary";

// LTc2 flat values: "opt1-p1" | "opt1-p2" | "opt2-p1" | "opt2-p2" | "opt3" | "none" | ""
type Ltc2Value = "opt1-p1" | "opt1-p2" | "opt2-p1" | "opt2-p2" | "opt3" | "none" | "";

interface BenchmarkFormData {
  address: string;
  city: string;
  stateProvince: string;
  country: string;
  zipCode: string;
  ratingSystem: string;
  // LTc1
  ltc1PreviouslyDeveloped: "yes" | "no" | "";
  // LTc2 - single flat selection
  ltc2Selection: Ltc2Value;
  // LTc5
  parkingSpaces: string;
  programType: string;
  ltc5Opt1X: boolean;
  ltc5Opt1Y: boolean;
  ltc5Opt2Z: boolean;
}

interface WalkScoreData {
  walkScore: number | null;
  transitScore: number | null;
  bikeScore: number | null;
  canonicalUrl: string | null;
  title: string | null;
  queriedAddress: string | null;
}

const STORAGE_KEY = "leed_v5_benchmark_project_location";

const RATING_SYSTEM_OPTIONS = [
  {
    value: "LEED BD+C: New Construction",
    label: "LEED BD+C: New Construction",
    disabled: false,
  },
  {
    value: "LEED BD+C: Core and Shell",
    label: "LEED BD+C: Core and Shell (Coming Soon)",
    disabled: true,
  },
  {
    value: "LEED ID+C: Commercial Interiors",
    label: "LEED ID+C: Commercial Interiors (Coming Soon)",
    disabled: true,
  },
  {
    value: "LEED O+M: Existing Buildings",
    label: "LEED O+M: Existing Buildings (Coming Soon)",
    disabled: true,
  },
] as const;

const DEFAULT_FORM_DATA: BenchmarkFormData = {
  address: "",
  city: "",
  stateProvince: "",
  country: "United States",
  zipCode: "",
  ratingSystem: "",
  ltc1PreviouslyDeveloped: "",
  ltc2Selection: "",
  parkingSpaces: "",
  programType: "",
  ltc5Opt1X: false,
  ltc5Opt1Y: false,
  ltc5Opt2Z: false,
};

// --- Scoring helpers ---

function getLtc1Points(form: BenchmarkFormData): number {
  return form.ltc1PreviouslyDeveloped === "yes" ? 1 : 0;
}

const LTC2_CONFIG: Record<
  Exclude<Ltc2Value, "" | "none">,
  { points: number; label: string; subLabel?: string }
> = {
  "opt1-p1": {
    points: 2,
    label: "OPTION 1. PRIORITY SITES",
    subLabel: "PATH 1. BROWNFIELD REMEDIATION",
  },
  "opt1-p2": {
    points: 1,
    label: "OPTION 1. PRIORITY SITES",
    subLabel: "PATH 2. HISTORIC LOCATION",
  },
  "opt2-p1": {
    points: 1,
    label: "OPTION 2. HOUSING AND JOBS PROXIMITY",
    subLabel: "PATH 1. SUPPORT LOCAL ECONOMY",
  },
  "opt2-p2": {
    points: 2,
    label: "OPTION 2. HOUSING AND JOBS PROXIMITY",
    subLabel: "PATH 2. LOCATION-EFFICIENT AFFORDABLE HOUSING",
  },
  "opt3": {
    points: 2,
    label: "OPTION 3. EQUITABLE CONSTRUCTION",
  },
};

function getLtc2Points(form: BenchmarkFormData): number {
  const sel = form.ltc2Selection;
  if (sel === "" || sel === "none") return 0;
  return LTC2_CONFIG[sel]?.points ?? 0;
}

function getLtc2Detail(form: BenchmarkFormData): { label: string; subLabel?: string } | null {
  const sel = form.ltc2Selection;
  if (sel === "" || sel === "none") return null;
  return LTC2_CONFIG[sel] ?? null;
}

// --- LTc5 helpers ---

/**
 * Calculate EVSE / EV-ready thresholds based on total parking spaces (A) and program type.
 *
 * Commercial:
 *   X = ceil(5%*A), min 2   → 1 pt (EVSE)
 *   Y = ceil(10%*A), min 4  → 2 pts (EVSE)
 *   Z = ceil(10%*A), min 10 → 1 pt (EV-ready)
 *
 * Residential:
 *   X = ceil(10%*A), min 5  → 1 pt
 *   Y = ceil(15%*A), min 10 → 2 pts
 *   Z = ceil(20%*A), min 20 → 1 pt
 */
function getLtc5Thresholds(parkingSpaces: number, programType: string) {
  if (programType === "commercial") {
    return {
      x: Math.max(Math.ceil(parkingSpaces * 0.05), 2),
      y: Math.max(Math.ceil(parkingSpaces * 0.1), 4),
      z: Math.max(Math.ceil(parkingSpaces * 0.1), 10),
    };
  }
  // residential (default)
  return {
    x: Math.max(Math.ceil(parkingSpaces * 0.1), 5),
    y: Math.max(Math.ceil(parkingSpaces * 0.15), 10),
    z: Math.max(Math.ceil(parkingSpaces * 0.2), 20),
  };
}

function getLtc5Points(form: BenchmarkFormData): number {
  // Option 1: Y (2pts) takes priority over X (1pt)
  const opt1Points = form.ltc5Opt1Y ? 2 : form.ltc5Opt1X ? 1 : 0;
  // Option 2: Z → 1pt
  const opt2Points = form.ltc5Opt2Z ? 1 : 0;
  return opt1Points + opt2Points;
}

function formatPointLabel(points: number): string {
  if (points === 0) return "0 Point";
  return points === 1 ? "1 Point" : `${points} Points`;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// --- UI Components ---

function CreditCard({
  title,
  points,
  pointsLabel: pointsLabelOverride,
  pointsVariant = "auto",
  headerBadge,
  children,
}: {
  title: string;
  points: number;
  pointsLabel?: string;
  pointsVariant?: "auto" | "filled" | "outline";
  headerBadge?: ReactNode;
  children?: ReactNode;
}) {
  const pointsLabel = pointsLabelOverride ?? formatPointLabel(points);
  const isFilled = pointsVariant === "filled" || (pointsVariant === "auto" && points > 0);

  return (
    <section className="overflow-hidden rounded-[18px] border border-[#DEE2E6] bg-white shadow-sm">
      <div className="flex items-center justify-between gap-4 bg-primary/8 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="text-base font-bold uppercase tracking-[0.04em] text-primary sm:text-[1.15rem]">
            {title}
          </h2>
          {headerBadge}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-[8px] px-5 py-2 text-sm font-bold sm:min-w-[112px] sm:text-base",
            isFilled
              ? "bg-primary text-white"
              : "border border-primary/35 bg-white text-primary"
          )}
        >
          {pointsLabel}
        </span>
      </div>
      {children ? (
        <div className="px-5 py-4 sm:px-6">{children}</div>
      ) : null}
    </section>
  );
}

function StatusBadge({ type }: { type: "coming-soon" | "docs-available" }) {
  if (type === "coming-soon") {
    return (
      <span className="inline-flex rounded-full bg-black/55 px-3 py-1 text-[11px] font-bold italic tracking-[0.01em] text-white">
        Coming Soon
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-primary px-3 py-1 text-[11px] font-bold italic tracking-[0.01em] text-white">
      Docs Available
    </span>
  );
}

function OptionRow({
  label,
  points,
  indent = false,
  badge,
  sourceUrl,
  children,
  noBorder = false,
}: {
  label: string;
  points: number;
  indent?: boolean;
  badge?: "coming-soon" | "docs-available";
  sourceUrl?: string;
  children?: ReactNode;
  noBorder?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 py-3",
        !noBorder && "border-b border-[#E9ECEF]",
        indent && "pl-10"
      )}
    >
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="text-sm font-bold uppercase tracking-[0.02em] text-foreground sm:text-[0.98rem]">
            {label}
          </h3>
          {badge ? <StatusBadge type={badge} /> : null}
        </div>
        {children}
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="block text-sm text-primary underline underline-offset-2"
          >
            Check Source
          </a>
        ) : null}
      </div>
      <span
        className={cn(
          "shrink-0 pt-0.5 text-sm font-semibold",
          points > 0 ? "text-primary" : "text-muted-foreground"
        )}
      >
        {formatPointLabel(points)}
      </span>
    </div>
  );
}

// --- Form Tab ---

function ProjectLocationTab({
  formData,
  onFieldChange,
  onStart,
  loading,
  validationMessage,
}: {
  formData: BenchmarkFormData;
  onFieldChange: (field: keyof BenchmarkFormData, value: string | boolean) => void;
  onStart: () => Promise<void>;
  loading: boolean;
  validationMessage: string | null;
}) {
  return (
    <section className="mx-auto w-full max-w-3xl space-y-6 px-2">
      {/* Project Location */}
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <p className="mb-4 text-sm font-semibold text-primary">Project Location</p>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              value={formData.address}
              onChange={(e) => onFieldChange("address", e.target.value)}
              placeholder="Street address"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => onFieldChange("city", e.target.value)}
                placeholder="City"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stateProvince">State/Province</Label>
              <Input
                id="stateProvince"
                value={formData.stateProvince}
                onChange={(e) => onFieldChange("stateProvince", e.target.value)}
                placeholder="e.g. New York or NY"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                value={formData.country}
                onChange={(e) => onFieldChange("country", e.target.value)}
                placeholder="e.g. United States"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zipCode">Zip Code</Label>
              <Input
                id="zipCode"
                value={formData.zipCode}
                onChange={(e) => onFieldChange("zipCode", e.target.value)}
                placeholder="e.g. 43001"
              />
            </div>
          </div>
        </div>
      </div>

      {/* LEED v5 Rating System */}
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="space-y-2">
          <Label>LEED v5 Rating System</Label>
          <Select
            value={formData.ratingSystem}
            onValueChange={(value) => onFieldChange("ratingSystem", value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select from the list" />
            </SelectTrigger>
            <SelectContent>
              {RATING_SYSTEM_OPTIONS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* LTc1: Sensitive Land Protection */}
      <div className="rounded-lg border bg-card p-6 shadow-sm space-y-4">
        <p className="text-sm font-bold text-foreground">
          Is the project located on previously developed land?
        </p>
        <RadioGroup
          value={formData.ltc1PreviouslyDeveloped}
          onValueChange={(v) => onFieldChange("ltc1PreviouslyDeveloped", v)}
          className="space-y-2"
        >
          <div className="flex items-center gap-3">
            <RadioGroupItem value="yes" id="ltc1-yes" />
            <Label htmlFor="ltc1-yes" className="cursor-pointer">Yes</Label>
          </div>
          <div className="flex items-center gap-3">
            <RadioGroupItem value="no" id="ltc1-no" />
            <Label htmlFor="ltc1-no" className="cursor-pointer">No</Label>
          </div>
        </RadioGroup>
      </div>

      {/* LTc2: Equitable Development */}
      <div className="rounded-lg border bg-card p-6 shadow-sm space-y-4">
        <p className="text-sm font-bold text-foreground">
          How will the project support equitable development?
        </p>

        <RadioGroup
          value={formData.ltc2Selection}
          onValueChange={(v) => onFieldChange("ltc2Selection", v)}
          className="space-y-2"
        >
          {/* Option 1, Path 1 */}
          <div className="flex items-start gap-3">
            <RadioGroupItem value="opt1-p1" id="ltc2-opt1p1" className="mt-0.5" />
            <Label htmlFor="ltc2-opt1p1" className="cursor-pointer leading-snug">
              Site the project on a brownfield with identified soil or groundwater contamination requiring remediation by local, state, or national authority.
            </Label>
          </div>
          {/* Option 1, Path 2 */}
          <div className="flex items-start gap-3">
            <RadioGroupItem value="opt1-p2" id="ltc2-opt1p2" className="mt-0.5" />
            <Label htmlFor="ltc2-opt1p2" className="cursor-pointer leading-snug">
              Locate the project in a historic district identified by the local government.
            </Label>
          </div>

          <p className="text-sm font-bold text-foreground pl-1">AND/OR</p>

          {/* Option 2, Path 1 */}
          <div className="flex items-start gap-3">
            <RadioGroupItem value="opt2-p1" id="ltc2-opt2p1" className="mt-0.5" />
            <Label htmlFor="ltc2-opt2p1" className="cursor-pointer leading-snug">
              Employ residents of the project&apos;s administrative district for at least 15% of construction jobs.
            </Label>
          </div>
          {/* Option 2, Path 2 */}
          <div className="flex items-start gap-3">
            <RadioGroupItem value="opt2-p2" id="ltc2-opt2p2" className="mt-0.5" />
            <Label htmlFor="ltc2-opt2p2" className="cursor-pointer leading-snug">
              For residential or mixed-use projects, include affordable units for households below AMI, with rentals kept affordable for at least 15 years.
            </Label>
          </div>

          <p className="text-sm font-bold text-foreground pl-1">OR</p>

          {/* Option 3 */}
          <div className="flex items-start gap-3">
            <RadioGroupItem value="opt3" id="ltc2-opt3" className="mt-0.5" />
            <Label htmlFor="ltc2-opt3" className="cursor-pointer leading-snug">
              Provide construction workers access to workforce development training conducted by an organization or government entity.
            </Label>
          </div>

          {/* None */}
          <div className="flex items-start gap-3">
            <RadioGroupItem value="none" id="ltc2-none" className="mt-0.5" />
            <Label htmlFor="ltc2-none" className="cursor-pointer">None of the above</Label>
          </div>
        </RadioGroup>
      </div>

      {/* LTc5: Parking & Program Type */}
      <div className="rounded-lg border bg-card p-6 shadow-sm space-y-4">
        <div className="space-y-2">
          <Label htmlFor="parkingSpaces" className="text-sm font-bold text-foreground">
            How many parking spaces will the project provide?
          </Label>
          <Input
            id="parkingSpaces"
            type="number"
            min="0"
            value={formData.parkingSpaces}
            onChange={(e) => onFieldChange("parkingSpaces", e.target.value)}
            placeholder="Enter number of parking spaces"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-bold text-foreground">Select your program type</Label>
          <Select
            value={formData.programType}
            onValueChange={(value) => onFieldChange("programType", value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select from the list" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="commercial">Commercial</SelectItem>
              <SelectItem value="residential">Residential</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Start Button */}
      <div className="flex justify-end pt-2">
        <Button onClick={onStart} className="px-7" loading={loading}>
          Start Benchmark
        </Button>
      </div>
      {validationMessage ? (
        <p className="text-right text-xs text-destructive">{validationMessage}</p>
      ) : null}
    </section>
  );
}

// --- Summary Tab ---

function SummaryTab({
  formData,
  walkScoreData,
  walkScoreLoading,
  walkScoreError,
  transitData,
  onFieldChange,
  onDownload,
  downloadLoading,
  downloadError,
}: {
  formData: BenchmarkFormData;
  walkScoreData: WalkScoreData;
  walkScoreLoading: boolean;
  walkScoreError: string | null;
  transitData: {
    totalWeekdayTrips: number;
    totalWeekendTrips: number;
    transitScore: number;
    qualifyingStations: unknown[];
    geocodedLocation: { lat: number; lng: number } | null;
  } | null;
  onFieldChange: (field: keyof BenchmarkFormData, value: string | boolean) => void;
  onDownload: () => Promise<void>;
  downloadLoading: boolean;
  downloadError: string | null;
}) {
  const ltc1Points = getLtc1Points(formData);
  const ltc2Points = getLtc2Points(formData);
  const ltc2Detail = getLtc2Detail(formData);

  const walkScoreText = walkScoreLoading
    ? "Calculating..."
    : walkScoreData.walkScore !== null
    ? String(walkScoreData.walkScore)
    : "--";

  // Walk score points calculation
  const walkScorePoints = useMemo(() => {
    if (walkScoreData.walkScore === null) return 0;
    if (walkScoreData.walkScore >= 80) return 3;
    if (walkScoreData.walkScore >= 70) return 2;
    if (walkScoreData.walkScore >= 60) return 1;
    return 0;
  }, [walkScoreData.walkScore]);

  const transitScore = transitData?.transitScore ?? 0;
  const ltc3TotalPoints = walkScorePoints + transitScore;

  // LTc5 scoring
  const ltc5Points = getLtc5Points(formData);
  const parkingCount = parseInt(formData.parkingSpaces, 10) || 0;
  const ltc5Thresholds =
    parkingCount > 0 && formData.programType
      ? getLtc5Thresholds(parkingCount, formData.programType)
      : null;

  const totalLTPoints = ltc1Points + ltc2Points + ltc3TotalPoints + ltc5Points;

  return (
    <div className="mx-auto max-w-[1140px] space-y-5">
      {/* LTc1 */}
      <CreditCard title="LTc1 Sensitive Land Protection" points={ltc1Points}>
        <OptionRow
          label="Option 1. Previously Developed Sites"
          points={ltc1Points}
          noBorder
        />
      </CreditCard>

      {/* LTc2 */}
      <CreditCard title="LTc2 Equitable Development" points={ltc2Points}>
        {ltc2Detail ? (
          <OptionRow label={ltc2Detail.label} points={ltc2Points} noBorder>
            {ltc2Detail.subLabel ? (
              <p className="pl-6 text-sm text-foreground sm:text-[0.95rem]">
                {ltc2Detail.subLabel}
              </p>
            ) : null}
          </OptionRow>
        ) : null}
      </CreditCard>

      {/* LTc3 */}
      <CreditCard
        title="LTc3 Compact and Connected Development"
        points={ltc3TotalPoints}
      >
        <div className="space-y-1">
          <OptionRow
            label="Option 1. Surrounding Density"
            points={0}
            badge="coming-soon"
          />
          <div>
            <OptionRow
              label="Option 2. Access to Transit"
              points={transitData?.transitScore ?? 0}
              badge="docs-available"
            >
              <Link
                href={`/benchmark/transit?${new URLSearchParams({
                  address: formData.address,
                  city: formData.city,
                  stateProvince: formData.stateProvince,
                  zipCode: formData.zipCode,
                  country: formData.country,
                }).toString()}`}
                target="_blank"
                className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-2"
              >
                View Transit Map &rarr;
              </Link>
            </OptionRow>
            <div className="pl-10 pb-3">
              <p className="text-sm text-muted-foreground">
                {transitData ? `${transitData.totalWeekdayTrips} Weekday Trips` : "Loading..."}
              </p>
              <p className="text-sm text-muted-foreground">
                {transitData ? `${transitData.totalWeekendTrips} Weekend Trips` : "Loading..."}
              </p>
            </div>
          </div>
          <div>
            <OptionRow
              label="Option 3. Walkable Location"
              points={walkScorePoints}
              badge="docs-available"
              sourceUrl={walkScoreData.canonicalUrl ?? undefined}
              noBorder
            >
              <p className="text-sm text-muted-foreground">
                Walk Score: {walkScoreText}
              </p>
            </OptionRow>
          </div>
        </div>
      </CreditCard>

      {/* LTc4 */}
      <CreditCard
        title="LTc4 Transportation Demand Management"
        points={0}
        pointsLabel="0-4 Points"
        pointsVariant="outline"
        headerBadge={<StatusBadge type="coming-soon" />}
      />

      {/* LTc5 */}
      <CreditCard title="LTc5 Electric Vehicles" points={ltc5Points}>
        <div className="space-y-6">
          {/* Option 1: EVSE */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-[0.02em] text-foreground sm:text-[0.98rem]">
              OPTION 1. ELECTRIC VEHICLE SUPPLY EQUIPMENT
            </h3>
            <div className="ml-6 mt-3 space-y-3">
              {/* X threshold → 1 pt */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="ltc5-opt1-x"
                    checked={formData.ltc5Opt1X}
                    onCheckedChange={(checked) =>
                      onFieldChange("ltc5Opt1X", Boolean(checked))
                    }
                  />
                  <label
                    htmlFor="ltc5-opt1-x"
                    className="text-sm text-foreground cursor-pointer"
                  >
                    <span className="font-bold">
                      {ltc5Thresholds?.x ?? "X"}
                    </span>{" "}
                    qualified EV parking spaces
                  </label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white hover:bg-primary/80"
                      >
                        ?
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-96 text-sm">
                      <p className="mb-2 font-semibold text-foreground">
                        Qualified electric vehicle supply equipment (EVSE) must:
                      </p>
                      <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground">
                        <li>
                          Support Level 2 or Level 3 charging and comply with
                          National Electrical Code (NFPA 70) requirements
                        </li>
                        <li>Provide 208–240V or higher per space</li>
                        <li>
                          Be ENERGY STAR–certified with connected functionality
                          and able to respond to time-of-use pricing signals
                        </li>
                        <li>
                          Include at least one accessible charging space (min. 9
                          ft wide + 5 ft access aisle) with features for users
                          with mobility, ambulatory, and visual impairments
                        </li>
                      </ul>
                    </PopoverContent>
                  </Popover>
                </div>
                <span className="shrink-0 text-sm font-semibold text-primary">
                  1 Point
                </span>
              </div>
              {/* Y threshold → 2 pts */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="ltc5-opt1-y"
                    checked={formData.ltc5Opt1Y}
                    onCheckedChange={(checked) =>
                      onFieldChange("ltc5Opt1Y", Boolean(checked))
                    }
                  />
                  <label
                    htmlFor="ltc5-opt1-y"
                    className="text-sm text-foreground cursor-pointer"
                  >
                    <span className="font-bold">
                      {ltc5Thresholds?.y ?? "Y"}
                    </span>{" "}
                    qualified EV parking spaces
                  </label>
                </div>
                <span className="shrink-0 text-sm font-semibold text-primary">
                  2 Points
                </span>
              </div>
            </div>
          </div>

          {/* Option 2: EV-Ready */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-[0.02em] text-foreground sm:text-[0.98rem]">
              OPTION 2. ELECTRIC VEHICLE READINESS
            </h3>
            <div className="ml-6 mt-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="ltc5-opt2-z"
                    checked={formData.ltc5Opt2Z}
                    onCheckedChange={(checked) =>
                      onFieldChange("ltc5Opt2Z", Boolean(checked))
                    }
                  />
                  <label
                    htmlFor="ltc5-opt2-z"
                    className="text-sm text-foreground cursor-pointer"
                  >
                    <span className="font-bold">
                      {ltc5Thresholds?.z ?? "Z"}
                    </span>{" "}
                    qualified EV-ready parking spaces
                  </label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white hover:bg-primary/80"
                      >
                        ?
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-96 text-sm">
                      <p className="text-muted-foreground">
                        EV-ready spaces must include a full circuit with
                        208–240V, 40-amp panel capacity, and conduit wiring
                        terminating in a junction box or charging outlet.
                      </p>
                      <p className="mt-3 text-xs font-medium text-muted-foreground">
                        Spaces counted for Option 1 may not be counted again.
                      </p>
                    </PopoverContent>
                  </Popover>
                </div>
                <span className="shrink-0 text-sm font-semibold text-primary">
                  1 Point
                </span>
              </div>
            </div>
          </div>
        </div>
      </CreditCard>

      {/* Congratulations */}
      <section className="space-y-3 py-5 text-center">
        <p className="text-[2rem] font-bold leading-none text-foreground">
          Congratulations!
        </p>
        <h2
          aria-label={`Your project qualifies for at least ${totalLTPoints} L&T points.`}
          className="text-lg font-bold leading-tight text-foreground sm:text-[1.7rem]"
        >
          Your project qualifies for at least{" "}
          <span className="mx-1 inline-block text-[3.5rem] leading-none text-primary sm:text-[4.25rem]">
            {totalLTPoints}
          </span>
          L&amp;T points.
        </h2>
        {walkScoreError ? (
          <p className="mt-2 text-sm text-destructive">
            {walkScoreError}
          </p>
        ) : null}
      </section>

      {/* Download Section */}
      <section className="rounded-[20px] bg-primary/5 px-6 py-12 text-center sm:px-10">
        <h2 className="text-[2rem] font-semibold tracking-tight text-foreground sm:text-[2.25rem]">
          Grab Your LEED Docs Now!
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">
          Everything you need to claim your eligible LEED points, ready to go.
        </p>
        <div className="mt-6">
          <Button
            className="h-14 rounded-xl px-10 text-xl font-bold shadow-sm sm:h-16 sm:text-2xl"
            onClick={onDownload}
            loading={downloadLoading}
            disabled={downloadLoading || !transitData?.geocodedLocation}
          >
            Download
          </Button>
        </div>
        {downloadError && (
          <p className="mt-3 text-sm text-destructive">{downloadError}</p>
        )}
        <p className="mt-4 text-sm text-muted-foreground">
          Includes supporting documentation for credits marked &quot;Docs Available&quot;
        </p>
      </section>
    </div>
  );
}

// --- Page ---

export default function BenchmarkPage() {
  const [activeTab, setActiveTab] = useState<BenchmarkTab>("location");
  const [formData, setFormData] = useState<BenchmarkFormData>(DEFAULT_FORM_DATA);
  const [isHydrated, setIsHydrated] = useState(false);
  const [walkScoreLoading, setWalkScoreLoading] = useState(false);
  const [walkScoreError, setWalkScoreError] = useState<string | null>(null);
  const [formValidationMessage, setFormValidationMessage] = useState<
    string | null
  >(null);
  const [walkScoreData, setWalkScoreData] = useState<WalkScoreData>({
    walkScore: null,
    transitScore: null,
    bikeScore: null,
    canonicalUrl: null,
    title: null,
    queriedAddress: null,
  });
  const [transitData, setTransitData] = useState<{
    totalWeekdayTrips: number;
    totalWeekendTrips: number;
    transitScore: number;
    qualifyingStations: unknown[];
    geocodedLocation: { lat: number; lng: number } | null;
  } | null>(null);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const isFormComplete = useMemo(() => {
    return (
      formData.address.trim().length > 0 &&
      formData.city.trim().length > 0 &&
      formData.stateProvince.trim().length > 0 &&
      formData.country.trim().length > 0 &&
      formData.zipCode.trim().length > 0 &&
      formData.ratingSystem.trim().length > 0
    );
  }, [formData]);

  const onTabChange = (value: string) => {
    if (value !== "location" && value !== "summary") return;

    if (value === "summary" && !isFormComplete) {
      setFormValidationMessage(
        "Please complete all fields in Project Location first."
      );
      return;
    }

    setFormValidationMessage(null);
    setActiveTab(value);
  };

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<BenchmarkFormData>;
        setFormData((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setIsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(formData));
  }, [formData, isHydrated]);

  useEffect(() => {
    if (activeTab !== "summary" || !formData.address || !formData.city) return;

    // Clear previous result immediately to avoid showing stale data
    // from a different address while the new request is in flight.
    setTransitData(null);

    const controller = new AbortController();
    fetch("/api/transit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: formData.address,
        city: formData.city,
        stateProvince: formData.stateProvince,
        zipCode: formData.zipCode,
        country: formData.country,
      }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Transit API returned ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setTransitData({
          totalWeekdayTrips: data.totalWeekdayTrips,
          totalWeekendTrips: data.totalWeekendTrips,
          transitScore: data.transitScore,
          qualifyingStations: data.qualifyingStations ?? [],
          geocodedLocation: data.geocodedLocation ?? null,
        });
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error("Transit fetch failed:", err);
          // transitData stays null — UI shows "Loading..." instead of stale data
        }
      });

    return () => controller.abort();
  }, [activeTab, formData.address, formData.city, formData.stateProvince, formData.zipCode, formData.country]);

  const updateField = (field: keyof BenchmarkFormData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (formValidationMessage) {
      setFormValidationMessage(null);
    }
  };

  const runWalkScoreAssessment = async () => {
    if (!isFormComplete) {
      setFormValidationMessage(
        "Please complete all fields in Project Location first."
      );
      return;
    }

    setFormValidationMessage(null);
    setActiveTab("summary");
    setWalkScoreLoading(true);
    setWalkScoreError(null);

    try {
      const response = await fetch("/api/walkscore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: formData.address,
          city: formData.city,
          stateProvince: formData.stateProvince,
          country: formData.country,
          zipCode: formData.zipCode,
        }),
      });

      const text = await response.text();
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error("Walk Score service returned an unexpected response.");
      }

      if (!response.ok) {
        throw new Error(
          (payload.error as string) || "Failed to load Walk Score."
        );
      }

      setWalkScoreData({
        walkScore: toNullableNumber(payload.walkScore),
        transitScore: toNullableNumber(payload.transitScore),
        bikeScore: toNullableNumber(payload.bikeScore),
        canonicalUrl: toNullableString(payload.canonicalUrl),
        title: toNullableString(payload.title),
        queriedAddress: toNullableString(payload.queriedAddress),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load Walk Score.";
      setWalkScoreError(message);
      setWalkScoreData((prev) => ({ ...prev, walkScore: null }));
    } finally {
      setWalkScoreLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!transitData?.geocodedLocation || !transitData.qualifyingStations) return;
    setDownloadLoading(true);
    setDownloadError(null);
    try {
      const res = await fetch("/api/transit/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: formData.address,
          city: formData.city,
          stateProvince: formData.stateProvince,
          zipCode: formData.zipCode,
          country: formData.country,
          geocodedLocation: transitData.geocodedLocation,
          qualifyingStations: transitData.qualifyingStations,
          totalWeekdayTrips: transitData.totalWeekdayTrips,
          totalWeekendTrips: transitData.totalWeekendTrips,
          transitScore: transitData.transitScore,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "LEED-Transit-Report.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloadLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="mx-auto w-full max-w-[1240px] flex-1 px-3 py-10 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="px-4 py-8 text-center sm:px-6">
          <h1 className="text-[2rem] font-bold text-foreground sm:text-[2.25rem]">
            LEED v5 Location &amp; Transportation Benchmark
          </h1>
          <p className="mx-auto mt-3 max-w-3xl text-base text-muted-foreground sm:text-lg">
            Type in your project address to view eligible LEED v5 credits and
            download the supporting documentation.
          </p>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={onTabChange} className="gap-0">
          <div className="border-b border-[#E9ECEF] bg-white">
            <TabsList className="mx-auto flex h-auto max-w-[1240px] items-stretch rounded-none bg-transparent p-0">
              {/* Step 1 */}
              <TabsTrigger
                value="location"
                className="group relative flex flex-1 items-center gap-3 rounded-none border-b-2 border-transparent px-6 py-4 after:hidden data-[state=active]:border-primary data-[state=active]:bg-primary/5"
              >
                <span className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors",
                  activeTab === "location"
                    ? "bg-primary text-white"
                    : "bg-primary/15 text-primary"
                )}>
                  1
                </span>
                <span className={cn(
                  "text-sm font-semibold sm:text-base",
                  activeTab === "location" ? "text-primary" : "text-muted-foreground"
                )}>
                  Project Location
                </span>
              </TabsTrigger>

              {/* Divider arrow */}
              <div className="flex items-center px-2">
                <ArrowRight className="h-4 w-4 text-muted-foreground/40" />
              </div>

              {/* Step 2 */}
              <TabsTrigger
                value="summary"
                disabled={!isFormComplete}
                className="group relative flex flex-1 items-center gap-3 rounded-none border-b-2 border-transparent px-6 py-4 after:hidden disabled:cursor-not-allowed disabled:opacity-100 data-[state=active]:border-primary data-[state=active]:bg-primary/5"
              >
                <span className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors",
                  activeTab === "summary"
                    ? "bg-primary text-white"
                    : isFormComplete
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground"
                )}>
                  2
                </span>
                <span className={cn(
                  "text-sm font-semibold sm:text-base",
                  activeTab === "summary"
                    ? "text-primary"
                    : isFormComplete
                    ? "text-muted-foreground"
                    : "text-muted-foreground/50"
                )}>
                  L&amp;T Summary
                </span>
                {!isFormComplete && (
                  <Lock className="ml-1 h-3.5 w-3.5 text-muted-foreground/40" />
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="location" className="mt-0 py-8">
            <ProjectLocationTab
              formData={formData}
              onFieldChange={updateField}
              onStart={runWalkScoreAssessment}
              loading={walkScoreLoading}
              validationMessage={formValidationMessage}
            />
          </TabsContent>

          <TabsContent value="summary" className="mt-0 px-2 py-8 sm:px-4">
            <SummaryTab
              formData={formData}
              walkScoreData={walkScoreData}
              walkScoreLoading={walkScoreLoading}
              walkScoreError={walkScoreError}
              transitData={transitData}
              onFieldChange={updateField}
              onDownload={handleDownload}
              downloadLoading={downloadLoading}
              downloadError={downloadError}
            />
          </TabsContent>
        </Tabs>
      </main>
      <footer className="border-t py-5 text-center text-xs tracking-wider text-muted-foreground">
        Copyright &copy; 2026 Anchor Sustainability LLC. All Rights Reserved.
      </footer>
    </div>
  );
}
