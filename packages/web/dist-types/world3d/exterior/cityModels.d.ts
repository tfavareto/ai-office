import type { Model } from '../scene/models';
export declare const BUILDINGS: readonly ["commercial/building-a", "commercial/building-b", "commercial/building-c", "commercial/building-d", "commercial/building-f", "commercial/building-h", "commercial/building-n", "commercial/building-skyscraper-a", "commercial/building-skyscraper-c", "commercial/building-skyscraper-e"];
export declare const TREES: readonly ["suburban/tree-large", "suburban/tree-small"];
export declare const CARS: readonly ["cars/sedan", "cars/suv", "cars/taxi", "cars/delivery", "cars/hatchback-sports", "cars/van"];
export interface CityModels {
    buildings: Model[];
    trees: Model[];
    cars: Model[];
}
export declare function loadCityModels(): Promise<CityModels>;
