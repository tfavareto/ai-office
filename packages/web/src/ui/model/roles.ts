// Roles: reusable instructions an agent starts with. Pure.
import { HIRE_MAX_ROLE_INSTRUCTIONS, HIRE_MAX_ROLE_NAME } from '@ai-office/shared';

export interface SavedRole {
  id: string;
  name: string;
  instructions: string;
}

export const MAX_ROLES = 50;

export function validRole(name: string, instructions: string): boolean {
  const cleanName = name.trim();
  const cleanInstructions = instructions.trim();
  return (
    cleanName.length > 0 &&
    cleanName.length <= HIRE_MAX_ROLE_NAME &&
    cleanInstructions.length > 0 &&
    cleanInstructions.length <= HIRE_MAX_ROLE_INSTRUCTIONS
  );
}

/** Adds a role; one with the same name is replaced, so editing is saving again under that name. */
export function addRole(list: readonly SavedRole[], role: SavedRole): SavedRole[] {
  const name = role.name.trim();
  const others = list.filter((entry) => entry.name.trim().toLowerCase() !== name.toLowerCase());
  return [{ ...role, name, instructions: role.instructions.trim() }, ...others].slice(0, MAX_ROLES);
}

export function removeRole(list: readonly SavedRole[], id: string): SavedRole[] {
  return list.filter((entry) => entry.id !== id);
}
