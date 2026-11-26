/**
 * In-game confirmation dialog. Native `window.confirm` isn't shown by the desktop app's web view,
 * so every "are you sure?" goes through this. Mount `dialog` once; `confirm` resolves true/false.
 */
import { derived, grain } from '@grainular/grains';
import { html, mounted, on } from '@grainular/nord';

export type ConfirmRequest = { title: string; body: string; action: string };
export type Confirm = (request: ConfirmRequest) => Promise<boolean>;

export const createConfirmation = () => {
    const pending = grain<(ConfirmRequest & { resolve: (yes: boolean) => void }) | null>(null);
    let element: HTMLDialogElement | null = null;

    const settle = (yes: boolean) => {
        const p = pending();
        if (!p) return;
        element?.close();
        pending.set(null);
        p.resolve(yes);
    };
    const host = mounted<HTMLDialogElement>((dialog) => {
        element = dialog;
        return () => {
            settle(false);
            element = null;
        };
    });
    const confirm: Confirm = (request) => {
        const dialog = element;
        if (!dialog?.isConnected || pending()) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => {
            pending.set({ ...request, resolve });
            dialog.showModal();
        });
    };
    const title = derived(pending, (p) => p?.title ?? '');
    const body = derived(pending, (p) => p?.body ?? '');
    const action = derived(pending, (p) => p?.action ?? '');

    return {
        confirm,
        dialog: html`<dialog class="confirm-modal" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-description" ${host}
        ${on('cancel', (event) => {
            event.preventDefault();
            settle(false);
        })}
        ${on('click', (event) => {
            if (event.target === event.currentTarget) settle(false);
        })}
        ${on('keydown', (event) => event.stopPropagation())}>
        <div class="modal-body confirm-body">
            <header><h2 id="confirm-title">${title}</h2></header>
            <div class="modal-scroll"><p id="confirm-description">${body}</p></div>
            <footer>
                <button type="button" class="ghost" autofocus ${on('click', () => settle(false))}>취소</button>
                <button type="button" class="warn" ${on('click', () => settle(true))}>${action}</button>
            </footer>
        </div>
    </dialog>`,
    };
};
