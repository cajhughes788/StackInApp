import { tryWrite } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"

export async function createWorkspaceAPI(body: {
  name: string
  type: "w2" | "independent"
}): Promise<{ workspace: any }> {
  return tryWrite(
    API_ENDPOINTS.workspaces.create,
    "POST",
    body
  )
}

export async function updateWorkspaceAPI(
  workspaceId: string,
  body: {
    name: string
  }
): Promise<{ workspace: any }> {
  return tryWrite(
    API_ENDPOINTS.workspaces.update(workspaceId),
    "PATCH",
    body
  )
}

export async function deleteWorkspaceAPI(
  workspaceId: string,
  body: {
    reason: string
  }
): Promise<{ ok: boolean; deletedWorkspaceId: string }> {
  return tryWrite(
    API_ENDPOINTS.workspaces.delete(workspaceId),
    "DELETE",
    body
  )
}
