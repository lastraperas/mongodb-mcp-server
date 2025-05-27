import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { Implementation } from "@modelcontextprotocol/sdk/types.js";
import logger, { LogId } from "./logger.js";
import EventEmitter from "events";
import { ConnectOptions } from "./config.js";
import { setAppNameParamIfMissing } from "./helpers/connectionOptions.js";
import { packageInfo } from "./helpers/packageInfo.js";

export class Session extends EventEmitter<{
    close: [];
    disconnect: [];
}> {
    sessionId?: string;
    serviceProvider?: NodeDriverServiceProvider;
    agentRunner?: {
        name: string;
        version: string;
    };

    constructor() {
        super();
    }

    setAgentRunner(agentRunner: Implementation | undefined) {
        if (agentRunner?.name && agentRunner?.version) {
            this.agentRunner = {
                name: agentRunner.name,
                version: agentRunner.version,
            };
        }
    }

    async disconnect(): Promise<void> {
        if (this.serviceProvider) {
            try {
                await this.serviceProvider.close(true);
            } catch (err: unknown) {
                const error = err instanceof Error ? err : new Error(String(err));
                logger.error(LogId.mongodbDisconnectFailure, "Error closing service provider:", error.message);
            }
            this.serviceProvider = undefined;
        }
        this.emit("disconnect");
    }

    async close(): Promise<void> {
        await this.disconnect();
        this.emit("close");
    }

    async connectToMongoDB(connectionString: string, connectOptions: ConnectOptions): Promise<void> {
        connectionString = setAppNameParamIfMissing({
            connectionString,
            defaultAppName: `${packageInfo.mcpServerName} ${packageInfo.version}`,
        });
        this.serviceProvider = await NodeDriverServiceProvider.connect(connectionString, {
            productDocsLink: "https://github.com/mongodb-js/mongodb-mcp-server/",
            productName: "MongoDB MCP",
            readConcern: {
                level: connectOptions.readConcern,
            },
            readPreference: connectOptions.readPreference,
            writeConcern: {
                w: connectOptions.writeConcern,
            },
            timeoutMS: connectOptions.timeoutMS,
        });
    }
}
