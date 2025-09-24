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
import { Input } from "@/components/ui/input";
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
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const feedbackSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Please enter a valid email address"),
  companyName: z.string().optional(),
  role: z.enum(
    [
      "Architect/Designer",
      "Engineer",
      "Consultant",
      "Contractor",
      "Owner/Developer",
      "Other",
    ],
    {
      message: "Please select your role",
    }
  ),
  roleOther: z.string().optional(),
  tools: z
    .object({
      feasibility: z.boolean().optional(),
      checklists: z.boolean().optional(),
      automation: z.boolean().optional(),
      pm: z.boolean().optional(),
      quickwins: z.boolean().optional(),
      other: z.boolean().optional(),
      other_text: z.string().optional(),
    })
    .refine(
      (tools) => {
        // At least one tool must be selected
        return Object.values(tools).some((value) => value === true);
      },
      {
        message: "Please select at least one LEED tool",
      }
    ),
  privacyConsent: z.boolean().optional(),
});

type FormValues = z.infer<typeof feedbackSchema>;

export function FeedbackSection() {
  const form = useForm<FormValues>({
    resolver: zodResolver(feedbackSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      companyName: "",
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
      privacyConsent: false,
    },
  });

  const roleValue = form.watch("role");
  const isOtherRole = roleValue === "Other";

  const onSubmit = async (values: FormValues) => {
    const payload = {
      first_name: values.firstName,
      last_name: values.lastName,
      email: values.email,
      company_name: values.companyName || null,
      role: values.role,
      role_other: values.role === "Other" ? values.roleOther || null : null,
      tools: {
        ...values.tools,
      } as Record<string, unknown>,
      privacy_consent: values.privacyConsent,
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
          Tell us about yourself and the LEED tools you're interested in.
        </p>

        <Card>
          <CardContent className="pt-8">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-8"
              >
                {/* Personal Information */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <span className="text-destructive">*</span> First Name
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="First Name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <span className="text-destructive">*</span> Last Name
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="Last Name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <span className="text-destructive">*</span> Email
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="you@company.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="companyName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company Name (Optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="Company Name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

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
                  {/* Display tools validation error */}
                  {form.formState.errors.tools && (
                    <p className="text-sm font-medium text-destructive">
                      {form.formState.errors.tools.message}
                    </p>
                  )}
                </div>

                {/* Privacy Consent */}
                <FormField
                  control={form.control}
                  name="privacyConsent"
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
                          GreenDoc respects your privacy. By checking this box,
                          you consent to GreenDoc using your information to
                          contact you about your feedback.
                        </span>
                      </FormLabel>
                    </FormItem>
                  )}
                />

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
