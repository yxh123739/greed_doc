"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NewsletterSection() {
  return (
    <section className="bg-primary text-primary-foreground py-16 px-8 mt-16">
      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center justify-between gap-8">
        {/* 左侧文字 */}
        <div className="flex-1 text-center lg:text-left">
          <h2 className="text-3xl font-bold mb-4">
            Subscribe to Our Newsletter
          </h2>
          <p className="text-lg text-primary-foreground/90">
            Get updates on the latest tools, insights, and resources
            <br />
            to help you succeed at LEED.
          </p>
        </div>

        {/* 右侧输入框 + 按钮 */}
        <form className="flex flex-col sm:flex-row gap-4 w-full lg:max-w-md">
          <Input
            type="email"
            placeholder="Enter your email here"
            className="flex-1 text-primary-foreground placeholder:text-primary-foreground/50 focus-visible:border-primary-foreground"
          />
          <Button
            type="submit"
            size="lg"
            variant="secondary"
            className="font-semibold whitespace-nowrap"
          >
            Submit
          </Button>
        </form>
      </div>
    </section>
  );
}
