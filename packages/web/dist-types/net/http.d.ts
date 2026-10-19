import { type PermissionDecision } from '@ai-office/shared';
import { type Backend, type DecisionResult, type TranscriptQuery } from './backend';
type FetchLike = typeof fetch;
export declare class HttpBackend implements Backend {
    private readonly baseUrl;
    private readonly fetchImpl;
    constructor(baseUrl?: string, fetchImpl?: FetchLike);
    private url;
    private request;
    private get;
    private post;
    sendMessage(agentIds: readonly string[], text: string): Promise<import("@ai-office/shared").BossMessage[]>;
    messages(agentId: string): Promise<import("@ai-office/shared").BossMessage[]>;
    decidePermission(requestId: string, decision: PermissionDecision): Promise<DecisionResult>;
    history(agentId: string): Promise<import("@ai-office/shared").Activity[]>;
    transcript(query: TranscriptQuery): Promise<import("@ai-office/shared").TranscriptPage>;
    sessions(): Promise<import("@ai-office/shared").RecentSession[]>;
    day(date: string): Promise<import("@ai-office/shared").DayStats>;
    setDemo(on: boolean): Promise<boolean>;
}
export {};
