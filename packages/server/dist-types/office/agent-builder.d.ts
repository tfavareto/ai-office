import { type Agent, type PermissionRequest } from '@ai-office/shared';
import { type SessionRecord, type SubRecord } from './records';
export interface Overlay {
    permission?: PermissionRequest;
    attention?: string;
}
export declare function mainAgentId(record: SessionRecord): string;
export declare function subAgentId(record: SessionRecord, agentId: string): string;
export declare function buildMainAgent(record: SessionRecord, projectId: string, person: {
    name: string;
    look: 'f' | 'm';
}, overlay: Overlay, now: number): Agent;
export declare function buildSubAgent(record: SessionRecord, sub: SubRecord, projectId: string, parentId: string, person: {
    name: string;
    look: 'f' | 'm';
}, overlay: Overlay, now: number): Agent;
