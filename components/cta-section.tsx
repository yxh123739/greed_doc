"use client";

import { Button } from "@/components/ui/button";

export function CTASection() {
  return (
    <div className="text-center mt-16 py-16 bg-gradient-to-br from-primary/5 to-primary/10 dark:from-gray-800 dark:to-primary/20 rounded-2xl">
      <div className="max-w-3xl mx-auto px-6">
        <h2 className="text-4xl font-bold text-gray-900 dark:text-white mb-6">
          Ready to make
          <br />
          it real?
        </h2>
        <p className="text-lg text-gray-600 dark:text-gray-300 mb-8 leading-relaxed">
          Generate your project checklist for your project and get started with
          LEED certification today.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button
            size="lg"
            className="bg-primary hover:bg-primary/90 text-white px-8 py-3 font-semibold"
          >
            Generate Checklist
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="px-8 py-3 font-semibold"
          >
            Products
          </Button>
        </div>
      </div>
    </div>
  );
}
