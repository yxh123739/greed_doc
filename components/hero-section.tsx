"use client";

import { Button } from "@/components/ui/button";

export function HeroSection() {
  return (
    <section className="bg-primary text-primary-foreground">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="text-center max-w-4xl mx-auto">
          {/* Title */}
          <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
            Discover your project&apos;s
            <br />
            LEED potential
          </h1>

          {/* Subtitle */}
          <p className="text-xl text-primary-foreground/90 mb-10 leading-relaxed max-w-2xl mx-auto">
            Simplify and automate LEED documentation with GreenDoc
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center sr-only">
            <Button
              size="lg"
              variant="secondary"
              className="px-8 py-3 font-semibold"
            >
              Products
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="px-8 py-3 font-semibold"
            >
              See Pricing
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
