/**
 * Airtable Scripting Extension Global Registry
 * Single source of truth for all scripting globals used by completions, hover, and diagnostics.
 * No imports from 'vscode' — pure data module.
 */

export interface ScriptMethodInfo {
    signature: string;
    description: string;
}

export interface ScriptGlobalInfo {
    description: string;
    methods: Record<string, ScriptMethodInfo>;
}

export const SCRIPT_GLOBALS: Record<string, ScriptGlobalInfo> = {
    base: {
        description: 'Represents the current Airtable base. Injected as a global in every script.',
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
            getCollaborators: {
                signature: 'base.getCollaborators(): Collaborator[]',
                description: 'Returns all collaborators in the base.',
            },
            activeCollaborators: {
                signature: 'base.activeCollaborators: Collaborator[]',
                description: 'Currently active collaborators (read-only property).',
            },
            createTableAsync: {
                signature: 'base.createTableAsync(name: string, fields: FieldConfig[]): Promise<Table>',
                description: 'Creates a new table with the specified name and fields.',
            },
        },
    },
    table: {
        description: 'Represents an Airtable table. Obtained via base.getTable() or iterating base.getTables().',
        methods: {
            id: {
                signature: 'table.id: string',
                description: 'Unique table ID.',
            },
            name: {
                signature: 'table.name: string',
                description: 'Table display name.',
            },
            fields: {
                signature: 'table.fields: Field[]',
                description: 'All fields in the table (read-only property).',
            },
            views: {
                signature: 'table.views: View[]',
                description: 'All views in the table (read-only property).',
            },
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
            createFieldAsync: {
                signature: 'table.createFieldAsync(name: string, type: string, options?: object): Promise<Field>',
                description: 'Creates a new field in the table.',
            },
        },
    },
    cursor: {
        description: 'Exposes the current user UI cursor state. Scripting Extension only — not available in automation scripts.',
        methods: {
            activeTableId: {
                signature: 'cursor.activeTableId: string | null',
                description: 'ID of the currently active table; null if no table is active.',
            },
            activeViewId: {
                signature: 'cursor.activeViewId: string | null',
                description: 'ID of the currently active view; null if no view is active.',
            },
            selectedRecordIds: {
                signature: 'cursor.selectedRecordIds: string[]',
                description: 'IDs of currently selected records. Empty array if no records are selected.',
            },
            selectedFieldIds: {
                signature: 'cursor.selectedFieldIds: string[]',
                description: 'IDs of currently selected fields. Empty array if no fields are selected.',
            },
        },
    },
    input: {
        description: 'Provides interactive input prompts for the script user. Scripting Extension only — not available in automation scripts except input.config().',
        methods: {
            textAsync: {
                signature: 'input.textAsync(label: string, options?: object): Promise<string>',
                description: 'Prompts the user to enter text. Returns the entered string.',
            },
            buttonsAsync: {
                signature: 'input.buttonsAsync(label: string, options: object[]): Promise<unknown>',
                description: "Displays buttons for the user to choose from. Returns the selected button's value.",
            },
            tableAsync: {
                signature: 'input.tableAsync(label: string, options?: object): Promise<Table>',
                description: 'Prompts the user to select a table. Returns the selected table.',
            },
            viewAsync: {
                signature: 'input.viewAsync(label: string, tableOrId: Table | string, options?: object): Promise<View>',
                description: 'Prompts the user to select a view. Returns the selected view.',
            },
            fieldAsync: {
                signature: 'input.fieldAsync(label: string, tableOrId: Table | string, options?: object): Promise<Field>',
                description: 'Prompts the user to select a field. Returns the selected field.',
            },
            recordAsync: {
                signature: 'input.recordAsync(label: string, tableOrId: Table | string): Promise<Record | null>',
                description: 'Prompts the user to select a record. Returns the selected record, or null.',
            },
            fileAsync: {
                signature: 'input.fileAsync(label: string, options?: object): Promise<File>',
                description: 'Prompts the user to upload a file. Auto-parses CSV, JSON, and XLSX formats.',
            },
            config: {
                signature: 'input.config(): object',
                description: 'Returns the script settings object configured via the Configure button. Available in both Scripting Extension and automation scripts.',
            },
        },
    },
    output: {
        description: 'Displays content in the script output panel. Scripting Extension only — not available in automation scripts.',
        methods: {
            text: {
                signature: 'output.text(text: string): void',
                description: 'Displays plain text in the output panel.',
            },
            markdown: {
                signature: 'output.markdown(markdown: string): void',
                description: 'Displays markdown-formatted content in the output panel.',
            },
            table: {
                signature: 'output.table(data: object[] | RecordQueryResult): void',
                description: 'Displays data as an interactive table in the output panel.',
            },
            clear: {
                signature: 'output.clear(): void',
                description: 'Clears the output panel.',
            },
        },
    },
    session: {
        description: 'Provides information about the currently logged-in user. Scripting Extension only.',
        methods: {
            currentUser: {
                signature: 'session.currentUser: { id: string; email: string; name: string }',
                description: 'The current user object with id, email, and name properties.',
            },
        },
    },
    fetch: {
        description: 'Standard browser fetch function. Subject to CORS restrictions.\n\n`fetch(url: string, init?: RequestInit): Promise<Response>`',
        methods: {},
    },
    remoteFetchAsync: {
        description: "Airtable-provided cross-origin HTTP request. Bypasses CORS by routing through Airtable's servers. Redirect follow mode is not supported. Scripting Extension only.",
        methods: {
            remoteFetchAsync: {
                signature: 'remoteFetchAsync(url: string, init?: RequestInit): Promise<Response>',
                description: "Makes a cross-origin HTTP request via Airtable's servers. Bypasses CORS restrictions. Note: redirect mode 'follow' is not supported; use 'error' or 'manual'.",
            },
        },
    },
};

export const SCRIPT_GLOBAL_NAMES: string[] = Object.keys(SCRIPT_GLOBALS);

export function getScriptGlobal(name: string): ScriptGlobalInfo | undefined {
    return SCRIPT_GLOBALS[name];
}
