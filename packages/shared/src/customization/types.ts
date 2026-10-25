// What a person changes about the office: names, looks, room finishes and the order of the rooms. The server keeps it
// in `<state dir>/customization.json` and applies it to every snapshot.
import type {
  AccessoryId,
  HairColorId,
  HairStyleId,
  OutfitId,
  PlantDensity,
  RoomFloor,
  RoomWall,
  SignStyle,
  SkinId,
} from './palettes';

export const CUSTOMIZATION_VERSION = 1;

/** Fields left out follow the next layer (room, account), and at the end the look drawn from the agent's seed. */
export interface AgentLook {
  skin?: SkinId;
  hairStyle?: HairStyleId;
  hairColor?: HairColorId;
  outfit?: OutfitId;
  accessory?: AccessoryId;
}

export interface RoomTheme {
  /** `#rrggbb`: the accent of the room (sign, wall trim, rug and carpet tint). */
  color?: string;
  floor?: RoomFloor;
  wall?: RoomWall;
  plants?: PlantDensity;
  sign?: SignStyle;
}

export interface AgentCustomization {
  name?: string;
  look?: AgentLook;
}

export interface RoomCustomization {
  /** Name shown instead of the folder's; the project itself does not change. */
  alias?: string;
  theme?: RoomTheme;
  /** Default look of everybody in the room ("the team"). */
  look?: AgentLook;
  pinned?: boolean;
  hidden?: boolean;
}

export interface AccountCustomization {
  look?: AgentLook;
}

export interface Customization {
  version: typeof CUSTOMIZATION_VERSION;
  /** By agent id (one per session or subagent). */
  agents: Record<string, AgentCustomization>;
  /** By project id (the absolute folder). */
  rooms: Record<string, RoomCustomization>;
  /** By account id. */
  accounts: Record<string, AccountCustomization>;
  /** Project ids in the order the person arranged the rooms. */
  order: string[];
}

export const MAX_CUSTOM_AGENTS = 300;
export const MAX_CUSTOM_ROOMS = 200;
export const MAX_CUSTOM_ACCOUNTS = 32;
export const MAX_CUSTOM_ORDER = 200;
export const MAX_KEY_LENGTH = 1024;
export const MAX_NAME_LENGTH = 32;
export const MAX_ALIAS_LENGTH = 40;
/** The file (and a request body) may not be bigger than this. */
export const MAX_CUSTOMIZATION_BYTES = 192 * 1024;

export function emptyCustomization(): Customization {
  return { version: CUSTOMIZATION_VERSION, agents: {}, rooms: {}, accounts: {}, order: [] };
}

/** Answer of `GET /api/customization` and of every write. */
export interface CustomizationResponse {
  customization: Customization;
}

export type CustomizationErrorCode =
  | 'invalid-body'
  | 'invalid-key'
  | 'invalid-name'
  | 'invalid-alias'
  | 'invalid-look'
  | 'invalid-theme'
  | 'invalid-order'
  | 'too-many-items'
  | 'too-large'
  | 'unsupported-version';

/** Body of a 400 answer: what is wrong and where (`field` is a path like `agents.<id>.name`). */
export interface CustomizationErrorBody {
  error: CustomizationErrorCode;
  field?: string;
}
