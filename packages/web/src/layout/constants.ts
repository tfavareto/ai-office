// Floor-plan constants. All values are in tiles unless noted (1 tile = 16 px in the 2D renderer).

export const TILE = 16;

/** Width of a core area (Recepção, Copa, Sala de reunião, Banheiros, Lounge) including its west wall column. */
export const CORE_W = 16;
/** Width of a project room including its west wall column. */
export const ROOM_W = 10;
/** Height of a room row: wall face + floor + low ledge. */
export const ROW_H = 12;
export const CORRIDOR_H = 5;

/** Rows of north-wall face drawn at the top of every room (non-walkable). */
export const WALL_ROWS = 2;
export const FLOOR_ROWS = 9;
export const LEDGE_ROWS = 1;

export const NORTH_Y = 0;
export const CORRIDOR_Y = NORTH_Y + ROW_H;
export const SOUTH_Y = CORRIDOR_Y + CORRIDOR_H;
export const BUILDING_H = SOUTH_Y + ROW_H;

/** First x of the project slots in the north row (after Recepção, Copa, Sala de reunião) and in the south row. */
export const NORTH_PROJECT_X = CORE_W * 3;
export const SOUTH_PROJECT_X = CORE_W * 2;

/** Maximum workstations in a project room. */
export const DESKS_PER_ROOM = 6;
