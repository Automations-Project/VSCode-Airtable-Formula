/**
 * Airtable Automation Script Global Registry
 * Single source of truth for all automation globals used by completions, hover, and diagnostics.
 * No imports from 'vscode' — pure data module.
 * No imports from engines/script/ — fully independent by D-01.
 */

export interface AutomationMethodInfo {
    signature: string;
    description: string;
}

export interface AutomationGlobalInfo {
    description: string;
    methods: Record<string, AutomationMethodInfo>;
}

export const AUTOMATION_GLOBALS: Record<string, AutomationGlobalInfo> = {
    base: {
        description: 'Represents the current Airtable base. Available in automation scripts.',
        methods: {
            id: {
                signature: 'base.id: string',
                description: "The base's unique ID.",
            },
            name: {
                signature: 'base.name: string',
                description: "The base's display name.",
            },
            tables: {
                signature: 'base.tables: Table[]',
                description: 'All tables in the base (read-only property).',
            },
            getTables: {
                signature: 'base.getTables(): Table[]',
                description: 'Returns an array of all tables in the base.',
            },
            getTable: {
                signature: 'base.getTable(nameOrId: string): Table',
                description: 'Returns the table with the given name or ID. Throws if not found.',
            },
        },
    },
    table: {
        description: 'Represents an Airtable table. Obtained via base.getTable() or base.tables.',
        methods: {
            id: { signature: 'table.id: string', description: 'Unique table ID.' },
            name: { signature: 'table.name: string', description: 'Table display name.' },
            fields: { signature: 'table.fields: Field[]', description: 'All fields in the table.' },
            views: { signature: 'table.views: View[]', description: 'All views in the table.' },
            getField: {
                signature: 'table.getField(nameOrId: string): Field',
                description: 'Returns the field with the given name or ID. Throws if not found.',
            },
            getView: {
                signature: 'table.getView(nameOrId: string): View',
                description: 'Returns the view with the given name or ID. Throws if not found.',
            },
            selectRecordsAsync: {
                signature: 'table.selectRecordsAsync(options?: object): Promise<RecordQueryResult>',
                description: 'Queries all records in the table. Options include fields and sorts.',
            },
            selectRecordAsync: {
                signature: 'table.selectRecordAsync(recordId: string, options?: object): Promise<Record | null>',
                description: 'Fetches a single record by ID. Returns null if not found.',
            },
            createRecordAsync: {
                signature: 'table.createRecordAsync(fields: object): Promise<string>',
                description: 'Creates one record with the given field values. Returns the new record ID.',
            },
            createRecordsAsync: {
                signature: 'table.createRecordsAsync(records: object[]): Promise<string[]>',
                description: 'Creates up to 50 records. Returns an array of new record IDs.',
            },
            updateRecordAsync: {
                signature: 'table.updateRecordAsync(record: Record | string, fields: object): Promise<void>',
                description: 'Updates a single record with the given field values.',
            },
            updateRecordsAsync: {
                signature: 'table.updateRecordsAsync(records: object[]): Promise<void>',
                description: 'Updates up to 50 records.',
            },
            deleteRecordAsync: {
                signature: 'table.deleteRecordAsync(record: Record | string): Promise<void>',
                description: 'Deletes a single record.',
            },
            deleteRecordsAsync: {
                signature: 'table.deleteRecordsAsync(records: Array<Record | string>): Promise<void>',
                description: 'Deletes up to 50 records.',
            },
        },
    },
    input: {
        description: 'Provides access to input variables configured in the automation script editor. Only input.config() is available — interactive input methods are not available in automation scripts.',
        methods: {
            config: {
                signature: 'input.config(): object',
                description: 'Returns the input variables object configured in the automation script editor. Access properties by name: `input.config().myVariable`.',
            },
        },
    },
    output: {
        description: 'Passes data from this script step to subsequent automation steps. Only output.set() is available — display methods (text, markdown, table) are not available in automation scripts.',
        methods: {
            set: {
                signature: 'output.set(key: string, value: JSONSerializable): void',
                description: 'Stores a JSON-serializable value under the given key, making it available to subsequent automation steps. Value must be a JSON-serializable type (string, number, boolean, array, or plain object). Maximum output size is 6 MB.',
            },
        },
    },
    fetch: {
        description: 'Standard fetch function. Runs server-side in automation scripts — no CORS restrictions apply. Timeout is 30 seconds. Maximum 50 fetch requests per automation run.\n\n`fetch(url: string, init?: RequestInit): Promise<Response>`',
        methods: {},
    },
};

export const AUTOMATION_GLOBAL_NAMES: string[] = Object.keys(AUTOMATION_GLOBALS);

export function getAutomationGlobal(name: string): AutomationGlobalInfo | undefined {
    return AUTOMATION_GLOBALS[name];
}
