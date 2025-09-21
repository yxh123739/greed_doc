"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";

import { Save, FolderOpen } from "lucide-react";

interface ProjectManagerProps {
  email: string | null;
  projects: { name: string }[];
  selectedProject: string;
  saving: boolean;
  onSave: (projectName: string) => Promise<void>;
  onLoad: (projectName: string) => Promise<void>;
}

type FormValues = {
  projectName: string;
};

export function ProjectManager({
  email,
  projects,
  selectedProject,
  saving,
  onSave,
  onLoad,
}: ProjectManagerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const form = useForm<FormValues>({
    defaultValues: { projectName: "" },
    mode: "onSubmit",
  });

  const onSubmit = async (values: FormValues) => {
    try {
      await onSave(values.projectName.trim());
      setDialogOpen(false);
      form.reset();
    } catch {
      // Error handling is done in the parent component
    }
  };

  if (!email) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Sign in to save and manage projects</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Save className="w-4 h-4" />
            Save Project
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save Project</DialogTitle>
            <DialogDescription>
              Enter a name for your project to save the current slider settings.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="projectName"
                rules={{
                  required: "Please enter a project name",
                  maxLength: {
                    value: 15,
                    message: "Project name must be 15 characters or less",
                  },
                  pattern: {
                    value: /^[a-zA-Z0-9\s-_]+$/,
                    message:
                      "Only letters, numbers, spaces, hyphens and underscores are allowed",
                  },
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter project name"
                        maxLength={15}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Select value={selectedProject} onValueChange={onLoad}>
        <SelectTrigger className="w-48">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4" />
            <SelectValue placeholder="Load project" />
          </div>
        </SelectTrigger>
        <SelectContent>
          {projects.length === 0 ? (
            <SelectItem disabled value="__none">
              No saved projects
            </SelectItem>
          ) : (
            projects.map((project) => (
              <SelectItem key={project.name} value={project.name}>
                {project.name}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
