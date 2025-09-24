import { supabase } from "./client";

export interface DbCategory {
  id: string;
  name: string;
  description: string;
  max_points: number;
  levels: string[];
  strategies: string;
  icon_key: string;
  order: number;
  is_public: boolean;
}

export async function fetchCategories(): Promise<DbCategory[]> {
  const { data, error } = await supabase
    .from("categories")
    .select(
      "id,name,description,max_points,levels,strategies,icon_key,order,is_public"
    )
    .order("order", { ascending: true });
  if (error) throw error;
  return data || [];
}

export interface FeedbackInsert {
  first_name: string;
  last_name: string;
  email: string;
  company_name?: string | null;
  role: string;
  role_other?: string | null;
  tools?: Record<string, unknown> | null;
  privacy_consent?: boolean;
}

export async function submitFeedback(payload: FeedbackInsert) {
  const { error } = await supabase.from("feedback").insert(payload);
  if (error) throw error;
}

export interface ContactRequestInsert {
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  job_title: string;
  company_name: string;
  message: string;
  hear_about_us?: string | null;
}

export async function submitContactRequest(payload: ContactRequestInsert) {
  const { error } = await supabase.from("contact_requests").insert(payload);
  if (error) throw error;
}

// Auth helpers
export async function getUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

// Project Scores
export type ProjectRow = {
  id: string;
  user_id: string;
  name: string;
  scores: Record<string, number>;
  created_at: string;
  updated_at: string;
};

export async function listProjects(): Promise<ProjectRow[]> {
  // Always filter by current user, even for admins
  const user = await getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("project_scores")
    .select("id,user_id,name,scores,created_at,updated_at")
    .eq("user_id", user.id) // Explicitly filter by current user
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as any) || [];
}

export async function saveProjectScores(
  name: string,
  scores: Record<string, number>
) {
  // get current user id from auth
  const user = await getUser();
  if (!user) throw new Error("Not authenticated");

  // Check if project already exists (update case)
  const { data: existing } = await supabase
    .from("project_scores")
    .select("id")
    .eq("user_id", user.id)
    .eq("name", name)
    .maybeSingle();

  // If it's a new project, check the limit
  if (!existing) {
    const { data: projects, error: countError } = await supabase
      .from("project_scores")
      .select("id")
      .eq("user_id", user.id);

    if (countError) throw countError;

    if (projects && projects.length >= 5) {
      throw new Error(
        "You can only save up to 5 projects. Please delete an existing project first."
      );
    }
  }

  const payload = {
    user_id: user.id,
    name,
    scores,
  };
  const { error } = await supabase
    .from("project_scores")
    .upsert(payload, { onConflict: "user_id,name" });
  if (error) throw error;
}

export async function loadProjectScores(
  name: string
): Promise<Record<string, number> | null> {
  const user = await getUser();
  if (!user) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("project_scores")
    .select("scores")
    .eq("user_id", user.id)
    .eq("name", name)
    .maybeSingle();
  if (error) throw error;
  return (data?.scores as any) ?? null;
}

export async function deleteProjectScores(name: string) {
  const user = await getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase
    .from("project_scores")
    .delete()
    .eq("user_id", user.id)
    .eq("name", name);
  if (error) throw error;
}

// Admin-only function to list all projects (for admin dashboard)
export async function listAllProjects(): Promise<ProjectRow[]> {
  const { data, error } = await supabase
    .from("project_scores")
    .select("id,user_id,name,scores,created_at,updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as any) || [];
}
