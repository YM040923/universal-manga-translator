export class BackendClient {
    baseUrl;
    constructor(baseUrl = "http://127.0.0.1:47831") {
        this.baseUrl = baseUrl;
    }
    async health() {
        try {
            const response = await fetch(`${this.baseUrl}/health`);
            return response.ok && Boolean((await response.json()).ok);
        }
        catch {
            return false;
        }
    }
    async submit(task) {
        const response = await fetch(`${this.baseUrl}/v1/surfaces/submit`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ task }),
        });
        return (await response.json());
    }
}
//# sourceMappingURL=backend-client.js.map