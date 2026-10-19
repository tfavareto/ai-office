import type { SlotPos } from './types';
/**
 * Project slots fill whichever row ends first (south starts right after the Lounge, north after the meeting room), so
 * both rows end almost aligned and the building grows east evenly.
 */
export declare function slotPosition(index: number): SlotPos;
/** East edge (exclusive) of each row when the first `count` slots are used. */
export declare function rowEnds(count: number): {
    north: number;
    south: number;
};
