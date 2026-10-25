// "Modo time": host a team or join one over the local network, see who is in, and choose what to share. The dialog
// only talks to this computer's own server (/api/team); the server speaks to the other computers.
import { memberColor, type HostMember, type HostStatus, type MemberStatus, type TeamStatus } from '@ai-office/shared';
import { t } from '../../i18n';
import { localOnlyHint, type AppContext } from '../context';
import { compact, h, setText } from '../dom';
import { linkText, linkTone, teamCodeText } from '../model/team-text';
import type { TeamData, TeamOutcome } from '../team-controller';
import { button, liveText, sectionTitle } from '../widgets';
import { Dialog, closeButton } from './overlay';
import { HostForm, JoinForm, rememberName } from './team-forms';
import { TeamSharing } from './team-sharing';

type View = 'localOnly' | 'loading' | 'unavailable' | 'choose' | 'hosting' | 'member';

const CONFIRM_MS = 6000;

function dot(tone: 'ok' | 'wait' | 'bad'): HTMLElement {
  return h('span', { class: `ao-team-dot is-${tone}`, 'aria-hidden': 'true' });
}

export class TeamDialog extends Dialog {
  private readonly error = h('p', { class: 'ao-team-error', role: 'alert', hidden: true });
  private readonly note = h('p', { class: 'ao-note ao-team-note', hidden: true });
  private readonly hostForm = new HostForm(t('team.host.start'), (values) => void this.startHosting(values));
  private readonly restartForm = new HostForm(
    t('team.host.restart'),
    (values) => void this.startHosting(values),
    'ao-team-restart',
  );
  private readonly joinForm = new JoinForm((values) => void this.join(values));
  private readonly sharing = new TeamSharing((prefs) => void this.run(this.ctx.team.setSharing(prefs)));
  private readonly choose = h(
    'section',
    { class: 'ao-team-choose' },
    h(
      'div',
      { class: 'ao-team-card' },
      h('h3', null, t('team.host.title')),
      h('p', { class: 'ao-note' }, t('team.host.desc')),
      this.hostForm.el,
    ),
    h(
      'div',
      { class: 'ao-team-card' },
      h('h3', null, t('team.join.title')),
      h('p', { class: 'ao-note' }, t('team.join.desc')),
      this.joinForm.el,
    ),
  );
  private readonly hostStatus = h('div', { class: 'ao-team-status' });
  private readonly hostAddress = h('div', { class: 'ao-block' });
  private readonly hostCode = h('div', { class: 'ao-block' });
  private readonly hostMembers = h('div', { class: 'ao-block' });
  private readonly hostFooter = h('div', { class: 'ao-team-footer' });
  private readonly hosting = h(
    'section',
    { class: 'ao-team-hosting' },
    this.hostStatus,
    this.restartForm.el,
    this.hostAddress,
    this.hostCode,
    this.hostMembers,
  );
  private readonly memberStatus = h('div', { class: 'ao-team-status' });
  private readonly memberFooter = h('div', { class: 'ao-team-footer' });
  private readonly member = h('section', { class: 'ao-team-member' }, this.memberStatus);
  private readonly sharingSlot = h('div', { class: 'ao-team-sharing-slot' }, this.sharing.el);
  private readonly footer = h('div', { class: 'ao-team-footers' }, this.hostFooter, this.memberFooter);
  private confirm: string | null = null;
  private confirmTimer: ReturnType<typeof setTimeout> | undefined;
  private signatures = {
    hostStatus: '',
    address: '',
    code: '',
    members: '',
    hostFooter: '',
    member: '',
    memberFooter: '',
  };

  constructor(app: AppContext) {
    super(app, 'team', 'ao-team-title', 'ao-dialog--team');
    this.panel.append(
      h(
        'header',
        { class: 'ao-dialog-head' },
        h('h2', { id: 'ao-team-title' }, t('team.title')),
        closeButton(t('common.close'), () => app.closeDialog()),
      ),
      h(
        'div',
        { class: 'ao-team-body' },
        h('p', { class: 'ao-note ao-team-subtitle' }, t('team.subtitle')),
        this.error,
        this.note,
        this.choose,
        this.hosting,
        this.member,
        this.sharingSlot,
        this.footer,
      ),
    );
  }

  protected onOpen(): void {
    this.confirm = null;
    this.ctx.team.start();
  }

  protected override onClose(): void {
    this.ctx.team.stop();
    this.cancelConfirm();
  }

  // ---- state --------------------------------------------------------------------------------------------------------

  private viewOf(data: TeamData): View {
    if (!this.ctx.isLocal) return 'localOnly';
    const status = data.status;
    if (status === null) return 'loading';
    if (!status.available) return 'unavailable';
    return status.role === 'host' ? 'hosting' : status.role === 'member' ? 'member' : 'choose';
  }

  protected update(): void {
    const data = this.ctx.team.get();
    const view = this.viewOf(data);
    const status = data.status;
    this.choose.hidden = view !== 'choose';
    this.hosting.hidden = view !== 'hosting';
    this.member.hidden = view !== 'member';
    this.sharingSlot.hidden = view !== 'hosting' && view !== 'member';
    this.footer.hidden = this.sharingSlot.hidden;
    this.hostFooter.hidden = view !== 'hosting';
    this.memberFooter.hidden = view !== 'member';
    this.error.hidden = data.error === '';
    setText(this.error, data.error);
    const note =
      view === 'localOnly'
        ? localOnlyHint()
        : view === 'loading'
          ? t('team.loading')
          : view === 'unavailable'
            ? t('team.unavailable')
            : '';
    this.note.hidden = note === '';
    setText(this.note, note);
    for (const form of [this.hostForm, this.restartForm, this.joinForm]) form.setBusy(data.busy);
    if (status === null || !status.available) return;
    this.hostForm.update(status.interfaces, {});
    if (status.sharing !== undefined) this.sharing.update(status.sharing, data.busy);
    if (status.host !== undefined && view === 'hosting') this.renderHosting(status, status.host, data.busy);
    if (status.member !== undefined && view === 'member') this.renderMember(status.member, data.busy);
  }

  // ---- hosting ------------------------------------------------------------------------------------------------------

  private renderHosting(status: TeamStatus, host: HostStatus, busy: boolean): void {
    const listening = host.link === 'listening';
    const expired = host.pairing !== undefined && this.ctx.now() >= host.pairing.expiresAt;
    this.restartForm.el.hidden = listening;
    this.restartForm.update(status.interfaces, { name: host.hostName, teamName: host.teamName });
    const address = host.address === undefined ? '' : `${host.address}:${host.port}`;

    const statusSig = JSON.stringify([host.teamName, host.link, address, host.error]);
    if (statusSig !== this.signatures.hostStatus) {
      this.signatures.hostStatus = statusSig;
      this.hostStatus.replaceChildren(
        dot(listening ? 'ok' : 'bad'),
        h(
          'div',
          { class: 'ao-team-status-text' },
          h('strong', null, host.teamName),
          h('span', null, listening ? t('team.host.status.listening', { address }) : t('team.host.status.stopped')),
          host.error !== undefined ? h('span', { class: 'ao-team-error-inline' }, teamCodeText(host.error)) : null,
        ),
      );
    }

    this.hostAddress.hidden = !listening;
    const addressSig = address;
    if (listening && addressSig !== this.signatures.address) {
      this.signatures.address = addressSig;
      this.hostAddress.replaceChildren(
        sectionTitle(t('team.host.addresses')),
        h(
          'div',
          { class: 'ao-team-copy' },
          h('code', { class: 'ao-team-address' }, address),
          button({
            label: t('team.host.copyAddress'),
            icon: 'copy',
            variant: 'soft',
            className: 'ao-btn--small',
            onClick: () => this.ctx.copy(address, t('team.host.copied')),
          }),
        ),
      );
    }

    this.hostCode.hidden = !listening;
    const pairing = host.pairing;
    const codeSig = JSON.stringify([pairing, expired, busy, listening]);
    if (listening && codeSig !== this.signatures.code) {
      this.signatures.code = codeSig;
      this.hostCode.replaceChildren(sectionTitle(t('team.host.code')), this.codeBody(host, expired, busy));
    }

    const membersSig = JSON.stringify([host.members, this.confirm, busy]);
    if (membersSig !== this.signatures.members) {
      this.signatures.members = membersSig;
      this.hostMembers.replaceChildren(
        sectionTitle(t('team.members.title'), h('span', { class: 'ao-section-count' }, String(host.members.length))),
        host.members.length === 0
          ? h('p', { class: 'ao-note' }, t('team.members.none'))
          : h('div', { class: 'ao-team-members' }, ...host.members.map((member) => this.memberRow(member, busy))),
      );
    }

    const footerSig = JSON.stringify([listening, this.confirm, busy]);
    if (footerSig !== this.signatures.hostFooter) {
      this.signatures.hostFooter = footerSig;
      const ending = this.confirm === 'end';
      this.hostFooter.replaceChildren(
        ...compact(
          listening
            ? button({
                label: t('team.host.stop'),
                variant: 'soft',
                onClick: () => void this.run(this.ctx.team.hostStop()),
              })
            : null,
          button({
            label: ending ? t('team.host.end.confirm') : t('team.host.end'),
            variant: 'danger',
            onClick: () =>
              this.confirmed('end', () =>
                this.run(this.ctx.team.end(), () => this.ctx.notifyLocal('info', t('team.toast.ended'))),
              ),
          }),
          ending ? h('p', { class: 'ao-note' }, t('team.host.end.hint')) : null,
        ),
      );
      for (const control of this.hostFooter.querySelectorAll('button')) control.disabled = busy;
    }
  }

  private codeBody(host: HostStatus, expired: boolean, busy: boolean): HTMLElement {
    const pairing = host.pairing;
    const fresh = button({
      label: t('team.host.newCode'),
      icon: 'reset',
      variant: 'soft',
      className: 'ao-btn--small',
      onClick: () => void this.run(this.ctx.team.newCode()),
    });
    fresh.disabled = busy;
    if (pairing === undefined)
      return h('div', { class: 'ao-team-code-none' }, h('p', { class: 'ao-note' }, t('team.host.code.none')), fresh);
    if (pairing.locked || expired)
      return h(
        'div',
        { class: 'ao-team-code-none' },
        h(
          'p',
          { class: 'ao-note ao-team-warn' },
          pairing.locked ? t('team.host.code.locked') : t('team.host.code.expired'),
        ),
        fresh,
      );
    return h(
      'div',
      { class: 'ao-team-code' },
      h(
        'div',
        { class: 'ao-team-code-row' },
        h('code', { class: 'ao-team-code-text', 'aria-label': t('team.host.code') }, pairing.code),
        button({
          label: t('team.host.code.copy'),
          icon: 'copy',
          variant: 'ghost',
          className: 'ao-btn--small',
          onClick: () => this.ctx.copy(pairing.code, t('team.host.code.copied')),
        }),
        fresh,
      ),
      h('p', { class: 'ao-note' }, `${t('team.host.code.expires')} `, liveText('until', pairing.expiresAt)),
      h('p', { class: 'ao-note' }, t('team.host.code.hint')),
    );
  }

  private memberRow(member: HostMember, busy: boolean): HTMLElement {
    const confirming = this.confirm === `remove:${member.id}`;
    const remove = button({
      label: confirming ? t('team.member.remove.confirm', { name: member.name }) : t('team.member.remove'),
      variant: confirming ? 'danger' : 'ghost',
      className: 'ao-btn--small',
      title: t('team.member.remove.label', { name: member.name }),
      onClick: () => this.confirmed(`remove:${member.id}`, () => this.run(this.ctx.team.revoke(member.id))),
    });
    remove.disabled = busy;
    const presence = member.online
      ? h('span', { class: 'ao-team-presence is-online' }, dot('ok'), t('team.person.online'))
      : h(
          'span',
          { class: 'ao-team-presence' },
          dot('bad'),
          t('team.person.offline'),
          member.lastSeenAt !== undefined ? ' · ' : ` · ${t('team.person.neverSeen')}`,
          member.lastSeenAt !== undefined ? liveText('ago', member.lastSeenAt) : null,
        );
    return h(
      'div',
      { class: 'ao-team-member-row' },
      h('span', { class: 'ao-team-swatch', style: `background:${memberColor(member.id)}`, 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'ao-team-member-info' },
        h('strong', null, member.name),
        h('span', { class: 'ao-note' }, member.device),
      ),
      presence,
      remove,
    );
  }

  // ---- member -------------------------------------------------------------------------------------------------------

  private renderMember(member: MemberStatus, busy: boolean): void {
    const sig = JSON.stringify([member]);
    if (sig !== this.signatures.member) {
      this.signatures.member = sig;
      this.memberStatus.replaceChildren(
        dot(linkTone(member.link)),
        h(
          'div',
          { class: 'ao-team-status-text' },
          h('strong', null, t('team.member.title', { team: member.teamName })),
          h('span', null, linkText(member.link)),
          member.error !== undefined ? h('span', { class: 'ao-team-error-inline' }, teamCodeText(member.error)) : null,
          h(
            'span',
            { class: 'ao-note' },
            t('team.member.host', { host: member.hostName ?? '', address: `${member.hostAddress}:${member.hostPort}` }),
          ),
        ),
      );
    }
    const footerSig = JSON.stringify([this.confirm, busy]);
    if (footerSig !== this.signatures.memberFooter) {
      this.signatures.memberFooter = footerSig;
      const leaving = this.confirm === 'leave';
      const leave = button({
        label: leaving ? t('team.leave.confirm') : t('team.leave'),
        variant: 'danger',
        onClick: () =>
          this.confirmed('leave', () =>
            this.run(this.ctx.team.leave(), () => this.ctx.notifyLocal('info', t('team.toast.left'))),
          ),
      });
      leave.disabled = busy;
      this.memberFooter.replaceChildren(leave, h('p', { class: 'ao-note' }, t('team.leave.hint')));
    }
  }

  // ---- actions ------------------------------------------------------------------------------------------------------

  private async startHosting(values: { name: string; teamName: string; address: string; port: number }): Promise<void> {
    rememberName(values.name);
    await this.run(
      this.ctx.team.hostStart({
        address: values.address,
        port: values.port,
        name: values.name,
        ...(values.teamName !== '' ? { teamName: values.teamName } : {}),
      }),
      () => this.ctx.notifyLocal('success', t('team.toast.hosting', { team: values.teamName || values.name })),
    );
  }

  private async join(values: { name: string; address: string; code: string }): Promise<void> {
    rememberName(values.name);
    const outcome = await this.run(
      this.ctx.team.join({ name: values.name, address: values.address, code: values.code }),
    );
    this.joinForm.clearCode();
    if (outcome.ok)
      this.ctx.notifyLocal(
        'success',
        t('team.toast.joined', { team: this.ctx.team.get().status?.member?.teamName ?? '' }),
      );
  }

  private async run(action: Promise<TeamOutcome>, onOk?: () => void): Promise<TeamOutcome> {
    this.cancelConfirm();
    const outcome = await action;
    if (outcome.ok) onOk?.();
    this.resetSignatures();
    this.ctx.refresh();
    return outcome;
  }

  /** Destructive actions ask twice: the first press changes the button, the second one acts. */
  private confirmed(key: string, action: () => void): void {
    if (this.confirm === key) {
      this.cancelConfirm();
      action();
      return;
    }
    this.confirm = key;
    clearTimeout(this.confirmTimer);
    this.confirmTimer = setTimeout(() => this.cancelConfirm(), CONFIRM_MS);
    this.resetSignatures();
    this.ctx.refresh();
  }

  private cancelConfirm(): void {
    clearTimeout(this.confirmTimer);
    if (this.confirm === null) return;
    this.confirm = null;
    this.resetSignatures();
    this.ctx.refresh();
  }

  private resetSignatures(): void {
    this.signatures = {
      hostStatus: '',
      address: '',
      code: '',
      members: '',
      hostFooter: '',
      member: '',
      memberFooter: '',
    };
  }
}
