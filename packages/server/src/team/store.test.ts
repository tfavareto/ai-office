import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { silentLogger } from '../log';
import { makeTempDir, removeDir } from '../test-helpers';
import { exportIdentity, newIdentity } from './keys';
import { TeamStore, readHostFile, readJoinedFile, readSettingsFile, type HostFile } from './store';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await removeDir(dir);
});

const hostFile = (): HostFile => ({
  teamId: 'team-abcdef12',
  teamName: 'Time',
  hostName: 'Helena',
  hostDevice: 'mac',
  identity: exportIdentity(newIdentity()),
  members: [{ id: 'member-12345678', name: 'Ana', device: 'pc', pub: exportIdentity(newIdentity()).pub, createdAt: 5 }],
  revoked: ['gone-12345678'],
  listen: { address: '192.168.0.2', port: 4849 },
});

describe('TeamStore', () => {
  test('round-trips the host file with private permissions', async () => {
    const dir = await makeTempDir('ai-office-store-');
    dirs.push(dir);
    const store = new TeamStore(dir, silentLogger);
    const file = hostFile();

    expect(await store.saveHost(file)).toBe(true);
    const again = new TeamStore(dir, silentLogger);
    await again.load();

    expect(again.host).toEqual(file);
    expect((await stat(join(dir, 'team'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, 'team', 'host.json'))).mode & 0o777).toBe(0o600);
  });

  test('a store with both roles keeps the host and drops the member', async () => {
    const dir = await makeTempDir('ai-office-store-');
    dirs.push(dir);
    const store = new TeamStore(dir, silentLogger);
    await store.saveHost(hostFile());
    await store.saveJoined({
      teamId: 'team-abcdef12',
      teamName: 'T',
      memberId: 'member-12345678',
      name: 'Ana',
      device: '',
      identity: exportIdentity(newIdentity()),
      hostPub: exportIdentity(newIdentity()).pub,
      hostName: 'H',
      address: '10.0.0.2',
      port: 4849,
    });
    const again = new TeamStore(dir, silentLogger);

    await again.load();

    expect(again.host).toBeDefined();
    expect(again.joined).toBeUndefined();
  });
});

describe('stored files are untrusted', () => {
  test('a host file with a public listen address or a broken key is refused or cleaned', () => {
    const good = hostFile();
    expect(readHostFile({ version: 1, ...good, listen: { address: '8.8.8.8', port: 4849 } })?.listen).toBeUndefined();
    expect(readHostFile({ version: 1, ...good, identity: { pub: 'x', priv: 'y' } })).toBeUndefined();
    expect(readHostFile({ version: 2, ...good })).toBeUndefined();
    expect(
      readHostFile({ version: 1, ...good, members: [{ id: 'bad id', name: 'x' }, ...good.members] })?.members,
    ).toHaveLength(1);
    expect(readHostFile(null)).toBeUndefined();
  });

  test('a member file must point at a LAN address', () => {
    expect(readJoinedFile({ version: 1, address: '8.8.8.8', port: 4849 })).toBeUndefined();
    expect(readJoinedFile('nope')).toBeUndefined();
  });

  test('settings default to sharing nothing extra and get a fresh salt', () => {
    const settings = readSettingsFile(undefined);
    expect(settings.share).toMatchObject({ paused: false, projectNames: false, usage: false });
    expect(settings.keySalt).toMatch(/^[0-9a-f]{64}$/);
    expect(readSettingsFile({ version: 1, share: { titles: true }, keySalt: settings.keySalt })).toMatchObject({
      share: { titles: true },
      keySalt: settings.keySalt,
    });
  });
});
