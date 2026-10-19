import type { Account, Activity, Agent, OfficeSnapshot, Project } from '@ai-office/shared';
export declare function activity(over?: Partial<Activity>): Activity;
export declare function agent(over?: Partial<Agent>): Agent;
export declare function project(over?: Partial<Project>): Project;
export declare function account(over?: Partial<Account>): Account;
export declare function snapshot(over?: Partial<OfficeSnapshot>): OfficeSnapshot;
