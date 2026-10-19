import type { Rooftop } from '../../layout/exterior';
import { type Ctx } from './ctx';
/** Ground the neighbouring buildings stand on between each other: dark gravel, so alleys do not read as empty patches. */
export declare const ALLEY_COLOR = "#5b5a57";
/** A neighbouring building seen from above: parapet, roof surface by kind, rooftop equipment, height shown by tone and shadow. */
export declare function paintRooftop(ctx: Ctx, roof: Rooftop): void;
