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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Save, FolderOpen, Trash2 } from "lucide-react";
import Link from "next/link";

interface ProjectManagerProps {
  email: string | null;
  projects: { name: string }[];
  selectedProject: string;
  saving: boolean;
  onSave: (projectName: string) => Promise<void>;
  onLoad: (projectName: string) => Promise<void>;
  onDelete: (projectName: string) => Promise<void>;
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
  onDelete,
}: ProjectManagerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string>("");

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

  const handleDelete = async () => {
    try {
      await onDelete(projectToDelete);
      setDeleteDialogOpen(false);
      setProjectToDelete("");
    } catch {
      // Error handling is done in the parent component
    }
  };

  if (!email) {
    return (
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Button variant="outline" asChild className="pr-3">
          <Link href="/signin">Sign In to Save Your Project! </Link>
        </Button>
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

      <div className="flex items-center gap-1">
        <Select value={selectedProject} onValueChange={onLoad}>
          <SelectTrigger className="w-40">
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

        {selectedProject && (
          <AlertDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
          >
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="px-2"
                onClick={() => setProjectToDelete(selectedProject)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Project</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete &quot;{projectToDelete}&quot;?
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}
