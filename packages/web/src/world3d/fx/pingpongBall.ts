// The ping-pong ball in 3D: one small sphere per table, resting on it or flying between the players during a rally.
import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import { ballAt, type PingPongTable } from '../../sim/pingpong';
import { TILE_M } from '../units';

const TABLE_TOP = 0.755;
const RADIUS = 0.02;

export class PingPongBall3D {
  readonly group = new Group();
  private readonly geometry = new SphereGeometry(RADIUS, 10, 8);
  private readonly material = new MeshBasicMaterial({ color: '#fffdf5', toneMapped: false });
  private balls: Mesh[] = [];

  update(tables: readonly PingPongTable[], time: number): void {
    while (this.balls.length < tables.length) {
      const ball = new Mesh(this.geometry, this.material);
      ball.castShadow = false;
      this.group.add(ball);
      this.balls.push(ball);
    }
    this.balls.forEach((mesh, i) => {
      const table = tables[i];
      mesh.visible = table !== undefined;
      if (!table) return;
      const ball = ballAt(table, time);
      mesh.position.set(ball.x * TILE_M, TABLE_TOP + RADIUS + ball.z * TILE_M, ball.y * TILE_M);
    });
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
