"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { submitFeedback } from "@/lib/supabase/queries";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";

type FormValues = {
  role:
    | "Architect/Designer"
    | "Engineer"
    | "Consultant"
    | "Contractor"
    | "Owner/Developer"
    | "Other";
  roleOther?: string;
  tools?: {
    feasibility?: boolean;
    checklists?: boolean;
    automation?: boolean;
    pm?: boolean; // credit tracking dashboard & task list
    quickwins?: boolean;
    other?: boolean;
    other_text?: string;
  };
};

export function FeedbackSection() {
  const form = useForm<FormValues>({
    defaultValues: {
      role: undefined as unknown as FormValues["role"],
      roleOther: "",
      tools: {
        feasibility: false,
        automation: false,
        pm: false,
        quickwins: false,
        checklists: false,
        other: false,
        other_text: "",
      },
    },
  });

  const roleValue = form.watch("role");
  const isOtherRole = roleValue === "Other";

  const onSubmit = async (values: FormValues) => {
    const payload = {
      role: values.role,
      role_other: values.role === "Other" ? values.roleOther || null : null,
      tools: {
        ...values.tools,
      } as Record<string, unknown>,
    };
    try {
      await submitFeedback(payload);
      toast("Thanks! Your information has been received.");
      form.reset();
    } catch (err: any) {
      toast(`Submission failed: ${err.message || String(err)}`);
    }
  };

  type ToolKey =
    | "feasibility"
    | "checklists"
    | "automation"
    | "pm"
    | "quickwins";

  const toolOptions: { key: ToolKey; label: string }[] = [
    {
      key: "feasibility",
      label: "LEED v5 feasibility tool",
    },
    {
      key: "checklists",
      label: "Auto-populated LEED checklist with project data",
    },
    {
      key: "automation",
      label: "AI-powered documentation tool",
    },
    {
      key: "quickwins",
      label: "Quick-win compliance strategies",
    },
    {
      key: "pm",
      label: "Credit tracking dashboard & task list",
    },
  ];

  return (
    <section className="mt-16 py-16 bg-gradient-to-br from-primary/5 to-primary/10 dark:from-gray-800 dark:to-primary/20 rounded-2xl">
      <div className="max-w-3xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6 text-center">
          We&apos;d love to hear your feedback!
        </h2>
        <p className="text-muted-foreground text-center mb-12">
          Select your role and the LEED tools you’re interested in.
        </p>

        <Card>
          <CardContent className="pt-8">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-8"
              >
                {/* Role */}
                <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
                  <FormField
                    control={form.control}
                    name="role"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <span className="text-destructive">*</span>{" "}
                          What&apos;s your role?
                        </FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger
                              className="w-full"
                              aria-label="Select your role"
                            >
                              <SelectValue placeholder="Select your role" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Architect/Designer">
                              Architect/Designer
                            </SelectItem>
                            <SelectItem value="Engineer">Engineer</SelectItem>
                            <SelectItem value="Consultant">
                              Consultant
                            </SelectItem>
                            <SelectItem value="Contractor">
                              Contractor
                            </SelectItem>
                            <SelectItem value="Owner/Developer">
                              Owner/Developer
                            </SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                {isOtherRole && (
                  <FormField
                    control={form.control}
                    name="roleOther"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Other role (please specify)</FormLabel>
                        <FormControl>
                          <input
                            className="w-full h-9 rounded-md border bg-background px-3 py-1 text-sm"
                            placeholder="Please specify your role"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {/* LEED Tools Interest */}
                <div className="space-y-3">
                  <FormLabel>
                    <span className="text-destructive">*</span> What LEED tools
                    are you most interested in exploring?
                  </FormLabel>
                  <div className="space-y-2">
                    {toolOptions.map((opt) => (
                      <FormField
                        key={opt.key}
                        control={form.control}
                        name={`tools.${opt.key}` as unknown as any}
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start gap-3 space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={!!field.value}
                                onCheckedChange={(v) => field.onChange(!!v)}
                              />
                            </FormControl>
                            <FormLabel className="font-normal">
                              <span className="text-sm leading-6">
                                {opt.label}
                              </span>
                            </FormLabel>
                          </FormItem>
                        )}
                      />
                    ))}
                    <FormField
                      control={form.control}
                      name={`tools.other`}
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start gap-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={!!field.value}
                              onCheckedChange={(v) => field.onChange(!!v)}
                            />
                          </FormControl>
                          <FormLabel className="font-normal">
                            <span className="text-sm leading-6">Other</span>
                          </FormLabel>
                        </FormItem>
                      )}
                    />
                    {form.watch("tools.other") && (
                      <FormField
                        control={form.control}
                        name={`tools.other_text`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <textarea
                                rows={3}
                                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                placeholder="Tell us what other LEED tools you'd like"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </div>
                </div>

                <div className="pt-2">
                  <Button
                    type="submit"
                    size="lg"
                    loading={form.formState.isSubmitting}
                  >
                    Submit
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
