import { defaultTestConfig, expectDefined, setupIntegrationTest } from "./helpers.js";
import { describeWithMongoDB } from "./tools/mongodb/mongodbHelpers.js";

describe("Server integration test", () => {
    describeWithMongoDB(
        "mongodb tools",
        (integration) => {
            it("should return positive number of tools and have only mongodb tools", async () => {
                const tools = await integration.mcpClient().listTools();
                expectDefined(tools);
                expect(tools.tools.length).toBeGreaterThan(0);

                const atlasTools = tools.tools.filter((tool) => tool.name.startsWith("atlas-"));
                expect(atlasTools.length).toBe(0);
            });

            it("should return no prompts", async () => {
                await expect(() => integration.mcpClient().listPrompts()).rejects.toMatchObject({
                    message: "MCP error -32601: Method not found",
                });
            });

            it("should return capabilities", () => {
                const capabilities = integration.mcpClient().getServerCapabilities();
                expectDefined(capabilities);
                expect(capabilities.completions).toBeUndefined();
                expect(capabilities.experimental).toBeUndefined();
                expectDefined(capabilities?.tools);
                expectDefined(capabilities?.logging);
                expect(capabilities?.prompts).toBeUndefined();
            });
        },
        () => defaultTestConfig
    );

    describe("with read-only mode", () => {
        const integration = setupIntegrationTest(() => ({
            ...defaultTestConfig,
            readOnly: true,
        }));

        it("should only register read and metadata operation tools when read-only mode is enabled", async () => {
            const tools = await integration.mcpClient().listTools();
            expectDefined(tools);
            expect(tools.tools.length).toBeGreaterThan(0);

            // Check that we have some tools available (the read and metadata ones)
            expect(tools.tools.some((tool) => tool.name === "find")).toBe(true);
            expect(tools.tools.some((tool) => tool.name === "collection-schema")).toBe(true);
            expect(tools.tools.some((tool) => tool.name === "list-databases")).toBe(true);

            // Check that non-read tools are NOT available
            expect(tools.tools.some((tool) => tool.name === "insert-one")).toBe(false);
            expect(tools.tools.some((tool) => tool.name === "update-many")).toBe(false);
            expect(tools.tools.some((tool) => tool.name === "delete-one")).toBe(false);
            expect(tools.tools.some((tool) => tool.name === "drop-collection")).toBe(false);
        });
    });
});
