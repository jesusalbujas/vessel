import JobsWorkspace from "../JobsWorkspace";
import JobsActivityWorkspace from "../JobsActivityWorkspace";

export default async function JobProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (projectId === "activity") return <JobsActivityWorkspace />;
  return <JobsWorkspace projectId={projectId} />;
}
