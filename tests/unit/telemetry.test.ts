import { Session } from "../../src/session.js";
import { DEVICE_ID_TIMEOUT, Telemetry } from "../../src/telemetry/telemetry.js";
import { BaseEvent, TelemetryResult } from "../../src/telemetry/types.js";
import { EventCache } from "../../src/telemetry/eventCache.js";
import { config } from "../../src/config.js";
import { jest } from "@jest/globals";
import logger, { LogId } from "../../src/logger.js";
import { createHmac } from "crypto";

// Mock EventCache to control and verify caching behavior
jest.mock("../../src/telemetry/eventCache.js");
const MockEventCache = EventCache as jest.MockedClass<typeof EventCache>;

describe("Telemetry", () => {
    const machineId = "test-machine-id";
    const hashedMachineId = createHmac("sha256", machineId.toUpperCase()).update("atlascli").digest("hex");

    let mockEventCache: jest.Mocked<EventCache>;
    let session: Session;
    let telemetry: Telemetry;

    // Helper function to create properly typed test events
    function createTestEvent(options?: {
        result?: TelemetryResult;
        component?: string;
        category?: string;
        command?: string;
        duration_ms?: number;
    }): Omit<BaseEvent, "properties"> & {
        properties: {
            component: string;
            duration_ms: number;
            result: TelemetryResult;
            category: string;
            command: string;
        };
    } {
        return {
            timestamp: new Date().toISOString(),
            source: "mdbmcp",
            properties: {
                component: options?.component || "test-component",
                duration_ms: options?.duration_ms || 100,
                result: options?.result || "success",
                category: options?.category || "test",
                command: options?.command || "test-command",
            },
        };
    }

    beforeEach(() => {
        // Reset mocks before each test
        jest.clearAllMocks();

        // Setup mocked EventCache
        mockEventCache = new MockEventCache() as jest.Mocked<EventCache>;
        mockEventCache.getEvents = jest.fn().mockReturnValue([]);
        mockEventCache.clearEvents = jest.fn().mockResolvedValue(undefined);
        mockEventCache.appendEvents = jest.fn().mockResolvedValue(undefined);
        MockEventCache.getInstance = jest.fn().mockReturnValue(mockEventCache);

        // Create a simplified session
        session = {
            sessionId: "test-session-id",
            agentRunner: { name: "test-agent", version: "1.0.0" } as const,
            close: jest.fn().mockResolvedValue(undefined),
            setAgentRunner: jest.fn().mockResolvedValue(undefined),
        } as unknown as Session;

        telemetry = Telemetry.create(session, config, {
            eventCache: mockEventCache,
            getRawMachineId: () => Promise.resolve(machineId),
        });

        config.telemetry = "enabled";
    });

    describe("sending events", () => {
        describe("when telemetry is enabled", () => {
            it("should correctly add common properties to events", () => {
                const commonProps = telemetry.getCommonProperties();

                // Use explicit type assertion
                const expectedProps: Record<string, string> = {
                    mcp_client_version: "1.0.0",
                    mcp_client_name: "test-agent",
                    session_id: "test-session-id",
                    config_connection_string: expect.any(String) as unknown as string,
                    device_id: hashedMachineId,
                };

                expect(commonProps).toMatchObject(expectedProps);
            });

            describe("machine ID resolution", () => {
                beforeEach(() => {
                    jest.clearAllMocks();
                    jest.useFakeTimers();
                });

                afterEach(() => {
                    jest.clearAllMocks();
                    jest.useRealTimers();
                });

                it("should successfully resolve the machine ID", async () => {
                    telemetry = Telemetry.create(session, config, {
                        getRawMachineId: () => Promise.resolve(machineId),
                    });

                    expect(telemetry["isBufferingEvents"]).toBe(true);
                    expect(telemetry.getCommonProperties().device_id).toBe(undefined);

                    await telemetry.deviceIdPromise;

                    expect(telemetry["isBufferingEvents"]).toBe(false);
                    expect(telemetry.getCommonProperties().device_id).toBe(hashedMachineId);
                });

                it("should handle machine ID resolution failure", async () => {
                    const loggerSpy = jest.spyOn(logger, "debug");

                    telemetry = Telemetry.create(session, config, {
                        getRawMachineId: () => Promise.reject(new Error("Failed to get device ID")),
                    });

                    expect(telemetry["isBufferingEvents"]).toBe(true);
                    expect(telemetry.getCommonProperties().device_id).toBe(undefined);

                    await telemetry.deviceIdPromise;

                    expect(telemetry["isBufferingEvents"]).toBe(false);
                    expect(telemetry.getCommonProperties().device_id).toBe("unknown");

                    expect(loggerSpy).toHaveBeenCalledWith(
                        LogId.telemetryDeviceIdFailure,
                        "telemetry",
                        "Error: Failed to get device ID"
                    );
                });

                it("should timeout if machine ID resolution takes too long", async () => {
                    const loggerSpy = jest.spyOn(logger, "debug");

                    telemetry = Telemetry.create(session, config, { getRawMachineId: () => new Promise(() => {}) });

                    expect(telemetry["isBufferingEvents"]).toBe(true);
                    expect(telemetry.getCommonProperties().device_id).toBe(undefined);

                    jest.advanceTimersByTime(DEVICE_ID_TIMEOUT / 2);

                    // Make sure the timeout doesn't happen prematurely.
                    expect(telemetry["isBufferingEvents"]).toBe(true);
                    expect(telemetry.getCommonProperties().device_id).toBe(undefined);

                    jest.advanceTimersByTime(DEVICE_ID_TIMEOUT);

                    await telemetry.deviceIdPromise;

                    expect(telemetry.getCommonProperties().device_id).toBe("unknown");
                    expect(telemetry["isBufferingEvents"]).toBe(false);
                    expect(loggerSpy).toHaveBeenCalledWith(
                        LogId.telemetryDeviceIdTimeout,
                        "telemetry",
                        "Device ID retrieval timed out"
                    );
                });
            });
        });

        describe("when telemetry is disabled", () => {
            beforeEach(() => {
                config.telemetry = "disabled";
            });

            afterEach(() => {
                config.telemetry = "enabled";
            });

            it("should not send events", async () => {
                const testEvent = createTestEvent();

                await telemetry.emitEvents([testEvent]);

                // Should not attempt to send when disabled
                expect(mockEventCache.appendEvents).not.toHaveBeenCalled();
            });
        });

        describe("when DO_NOT_TRACK environment variable is set", () => {
            let originalEnv: string | undefined;

            beforeEach(() => {
                originalEnv = process.env.DO_NOT_TRACK;
                process.env.DO_NOT_TRACK = "1";
            });

            afterEach(() => {
                if (originalEnv) {
                    process.env.DO_NOT_TRACK = originalEnv;
                } else {
                    delete process.env.DO_NOT_TRACK;
                }
            });

            it("should not send events", async () => {
                const testEvent = createTestEvent();

                await telemetry.emitEvents([testEvent]);

                // Should not attempt to send when DO_NOT_TRACK is set
                expect(mockEventCache.appendEvents).not.toHaveBeenCalled();
            });
        });
    });
});
