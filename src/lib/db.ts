import Dexie, { type Table } from 'dexie';

export interface MapTile {
  id: string; // "z/x/y"
  data: Blob;
  timestamp: number;
}

export class MapDatabase extends Dexie {
  tiles!: Table<MapTile>;

  constructor() {
    super('MapOfflineDB');
    this.version(1).stores({
      tiles: 'id, timestamp'
    });
  }
}

export const db = new MapDatabase();
