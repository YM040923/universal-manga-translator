import type { FailedResult, JobStatus, SurfaceResult, SurfaceTask } from "./types.js";
export interface SubmitSurfaceRequest {
    task: SurfaceTask;
}
export interface SubmitSurfaceResponse {
    ok: true;
    surfaceId: string;
    status: JobStatus;
    result?: SurfaceResult;
}
export interface ErrorResponse {
    ok: false;
    error: string;
}
export type ApiResponse<T> = T | ErrorResponse;
export type ServerEvent = {
    type: "backend.ready";
    port: number;
} | {
    type: "job.queued";
    surfaceId: string;
} | {
    type: "job.processing";
    surfaceId: string;
} | {
    type: "job.cached";
    surfaceId: string;
    result: SurfaceResult;
} | {
    type: "job.completed";
    surfaceId: string;
    result: SurfaceResult;
} | {
    type: "job.failed";
    surfaceId: string;
    result: FailedResult;
};
