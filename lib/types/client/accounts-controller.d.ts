import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client';
import { type AccountSettings } from '../accounts.js';
/** All edits use the namespace's revision fence and never read credential values. */
export declare class AccountsController {
    private readonly scope;
    constructor(scope: SettingsScope<AccountSettings>);
    private snapshot;
    add(id: string): Promise<void>;
    save(id: string, label: string, key: string): Promise<void>;
    remove(id: string): Promise<void>;
}
//# sourceMappingURL=accounts-controller.d.ts.map