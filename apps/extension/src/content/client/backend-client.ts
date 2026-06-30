import type { ApiResponse, SubmitSurfaceRequest, SubmitSurfaceResponse } from "@umt/shared/protocol";
import type { SurfaceTask } from "@umt/shared/types";

export class BackendClient {
  constructor(private readonly baseUrl = "http://127.0.0.1:47831") {}

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok && Boolean((await response.json()).ok);
    } catch {
      return false;
    }
  }

  async submit(task: SurfaceTask): Promise<ApiResponse<SubmitSurfaceResponse>> {
    const response = await fetch(`${this.baseUrl}/v1/surfaces/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task } satisfies SubmitSurfaceRequest),
    });
    return (await response.json()) as ApiResponse<SubmitSurfaceResponse>;
  }
}
