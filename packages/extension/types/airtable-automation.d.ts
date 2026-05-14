type TableId = string;
type ViewId = string;
type FieldId = string;

declare var output: {
    set(key: string, value: unknown): void;
};

declare interface ButtonOption<T = string> {
    label: string;
    value?: T;
    variant?: "default" | "danger" | "primary" | "secondary";
}
declare interface FileOption {
    hasHeaderRow?: boolean;
    allowedFileTypes?: Array<string>;
    useRawValues?: boolean;
}
declare interface Blob {
    readonly size: number;
    readonly type: string;
    slice(start?: number, end?: number, contentType?: string): Blob;
}
declare interface File extends Blob {
    readonly lastModified: number;
    readonly name: string;
}
declare interface Collaborator {
    /**
     * The user or user group ID of the collaborator.
     */
    readonly id: string;
    /**
     * The email address of the user collaborator or an RFC 2822 mailbox-list (comma-separated list of emails) that
     * can be used to contact all members of the user group collaborator.
     */
    readonly email: string;
    /**
     * The name of the collaborator. Could be `null` if the user's Airtable account doesn't yet have a name.
     */
    readonly name: string | null;
    /**
     * The URL of the collaborator's profile picture. Could be `null` if the user's Airtable account hasn't set a
     * profile picture or the collaborator is a user group.
     */
    readonly profilePicUrl: string | null;
}
declare interface AirtableRecord {
    /**
     * The unique ID of this record.
     */
    readonly id: string;
    /**
     * The primary cell value as a string, or 'Unnamed record' if primary cell value is empty.
     */
    readonly name: string;
    /**
     * Gets a specific cell value in this record. See cell values & field options for the cell value format for each field type.
     */
    getCellValue(fieldOrIdOrName: Field | string): any;
    /**
     * Gets a specific cell value in this record, formatted as a `string`.
     */
    getCellValueAsString(fieldOrIdOrName: Field | string): string;
}
declare interface RecordQueryResult {
    /**
     * The record IDs in this RecordQueryResult.
     */
    readonly recordIds: ReadonlyArray<string>;
    /**
     * The records in this RecordQueryResult. These are instances of the Record class.
     */
    readonly records: ReadonlyArray<AirtableRecord>;
    /**
     * Get a specific record in the query result, or throw if that record doesn't exist or was filtered
     * out.
     */
    getRecord(recordId: string): AirtableRecord;
}
declare type FieldOptionsWriteFormat<FieldTypeT extends "singleLineText" | "email" | "url" | "multilineText" | "number" | "percent" | "currency" | "singleSelect" | "multipleSelects" | "singleCollaborator" | "multipleCollaborators" | "multipleRecordLinks" | "date" | "dateTime" | "phoneNumber" | "multipleAttachments" | "checkbox" | "formula" | "createdTime" | "rollup" | "count" | "multipleLookupValues" | "autoNumber" | "barcode" | "rating" | "richText" | "duration" | "lastModifiedTime" | "button" | "createdBy" | "lastModifiedBy" | "externalSyncSource" | "aiText"> =
FieldTypeT extends 'checkbox' ? {
    // an icon name
    icon: 'check' | 'star' | 'heart' | 'thumbsUp' | 'flag' | 'dot',
    // the color of the check box
    color: 'yellowBright' | 'orangeBright' | 'redBright' | 'pinkBright' | 'purpleBright' | 'blueBright' | 'cyanBright' | 'tealBright' | 'greenBright' | 'grayBright' ,
} :
FieldTypeT extends 'singleSelect' ? {
    choices: Array<
        // New choice format
        | {name: string, color?: string}
        // Pre-existing choices use read format specified above
        | {id: string, name: string, color?: string}
    >
} :
FieldTypeT extends 'multipleSelects' ? {
    choices: Array<
        // New choice format
        | {name: string, color?: string}
        // Pre-existing choices use read format specified above
        | {id: string, name: string, color?: string}
    >
} :
FieldTypeT extends 'singleCollaborator' ? null :
FieldTypeT extends 'multipleCollaborators' ? null :
FieldTypeT extends 'number' ? {
    precision: number, // from 0 to 8 inclusive
} :
FieldTypeT extends 'percent' ? {
    precision: number, // from 0 to 8 inclusive
} :
FieldTypeT extends 'currency' ? {
    precision: number, // from 0 to 7 inclusive
    symbol: string,
} :
FieldTypeT extends 'duration' ? {
    durationFormat: 'h:mm' | 'h:mm:ss' | 'h:mm:ss.S' | 'h:mm:ss.SS' | 'h:mm:ss.SSS'
} :
FieldTypeT extends 'singleLineText' ? null :
FieldTypeT extends 'email' ? null :
FieldTypeT extends 'url' ? null :
FieldTypeT extends 'multilineText' ? null :
FieldTypeT extends 'phoneNumber' ? null :
FieldTypeT extends 'richText' ? null :
FieldTypeT extends 'barcode' ? null :
FieldTypeT extends 'multipleAttachments' ? null :
FieldTypeT extends 'date' ? {
    dateFormat:
        // Format is optional, but must match name if provided.
        | {name: 'local', format?: 'l'}
        | {name: 'friendly', format?: 'LL'}
        | {name: 'us', format?: 'M/D/YYYY'}
        | {name: 'european', format?: 'D/M/YYYY'}
        | {name: 'iso', format?: 'YYYY-MM-DD'}
} :
FieldTypeT extends 'dateTime' ? {
    dateFormat:
        // Format is optional, but must match name if provided.
        | {name: 'local', format?: 'l'}
        | {name: 'friendly', format?: 'LL'}
        | {name: 'us', format?: 'M/D/YYYY'}
        | {name: 'european', format?: 'D/M/YYYY'}
        | {name: 'iso', format?: 'YYYY-MM-DD'},
    timeFormat:
        // Format is optional, but must match name if provided.
        | {name: '12hour', format?: 'h:mma'}
        | {name: '24hour', format?: 'HH:mm'},
    timeZone: 'utc' | 'client' | 'Africa/Abidjan' | 'Africa/Accra' | 'Africa/Addis_Ababa' | 'Africa/Algiers' | 'Africa/Asmara' | 'Africa/Bamako' | 'Africa/Bangui' | 'Africa/Banjul' | 'Africa/Bissau' | 'Africa/Blantyre' | 'Africa/Brazzaville' | 'Africa/Bujumbura' | 'Africa/Cairo' | 'Africa/Casablanca' | 'Africa/Ceuta' | 'Africa/Conakry' | 'Africa/Dakar' | 'Africa/Dar_es_Salaam' | 'Africa/Djibouti' | 'Africa/Douala' | 'Africa/El_Aaiun' | 'Africa/Freetown' | 'Africa/Gaborone' | 'Africa/Harare' | 'Africa/Johannesburg' | 'Africa/Juba' | 'Africa/Kampala' | 'Africa/Khartoum' | 'Africa/Kigali' | 'Africa/Kinshasa' | 'Africa/Lagos' | 'Africa/Libreville' | 'Africa/Lome' | 'Africa/Luanda' | 'Africa/Lubumbashi' | 'Africa/Lusaka' | 'Africa/Malabo' | 'Africa/Maputo' | 'Africa/Maseru' | 'Africa/Mbabane' | 'Africa/Mogadishu' | 'Africa/Monrovia' | 'Africa/Nairobi' | 'Africa/Ndjamena' | 'Africa/Niamey' | 'Africa/Nouakchott' | 'Africa/Ouagadougou' | 'Africa/Porto-Novo' | 'Africa/Sao_Tome' | 'Africa/Tripoli' | 'Africa/Tunis' | 'Africa/Windhoek' | 'America/Adak' | 'America/Anchorage' | 'America/Anguilla' | 'America/Antigua' | 'America/Araguaina' | 'America/Argentina/Buenos_Aires' | 'America/Argentina/Catamarca' | 'America/Argentina/Cordoba' | 'America/Argentina/Jujuy' | 'America/Argentina/La_Rioja' | 'America/Argentina/Mendoza' | 'America/Argentina/Rio_Gallegos' | 'America/Argentina/Salta' | 'America/Argentina/San_Juan' | 'America/Argentina/San_Luis' | 'America/Argentina/Tucuman' | 'America/Argentina/Ushuaia' | 'America/Aruba' | 'America/Asuncion' | 'America/Atikokan' | 'America/Bahia' | 'America/Bahia_Banderas' | 'America/Barbados' | 'America/Belem' | 'America/Belize' | 'America/Blanc-Sablon' | 'America/Boa_Vista' | 'America/Bogota' | 'America/Boise' | 'America/Cambridge_Bay' | 'America/Campo_Grande' | 'America/Cancun' | 'America/Caracas' | 'America/Cayenne' | 'America/Cayman' | 'America/Chicago' | 'America/Chihuahua' | 'America/Costa_Rica' | 'America/Creston' | 'America/Cuiaba' | 'America/Curacao' | 'America/Danmarkshavn' | 'America/Dawson' | 'America/Dawson_Creek' | 'America/Denver' | 'America/Detroit' | 'America/Dominica' | 'America/Edmonton' | 'America/Eirunepe' | 'America/El_Salvador' | 'America/Fort_Nelson' | 'America/Fortaleza' | 'America/Glace_Bay' | 'America/Godthab' | 'America/Goose_Bay' | 'America/Grand_Turk' | 'America/Grenada' | 'America/Guadeloupe' | 'America/Guatemala' | 'America/Guayaquil' | 'America/Guyana' | 'America/Halifax' | 'America/Havana' | 'America/Hermosillo' | 'America/Indiana/Indianapolis' | 'America/Indiana/Knox' | 'America/Indiana/Marengo' | 'America/Indiana/Petersburg' | 'America/Indiana/Tell_City' | 'America/Indiana/Vevay' | 'America/Indiana/Vincennes' | 'America/Indiana/Winamac' | 'America/Inuvik' | 'America/Iqaluit' | 'America/Jamaica' | 'America/Juneau' | 'America/Kentucky/Louisville' | 'America/Kentucky/Monticello' | 'America/Kralendijk' | 'America/La_Paz' | 'America/Lima' | 'America/Los_Angeles' | 'America/Lower_Princes' | 'America/Maceio' | 'America/Managua' | 'America/Manaus' | 'America/Marigot' | 'America/Martinique' | 'America/Matamoros' | 'America/Mazatlan' | 'America/Menominee' | 'America/Merida' | 'America/Metlakatla' | 'America/Mexico_City' | 'America/Miquelon' | 'America/Moncton' | 'America/Monterrey' | 'America/Montevideo' | 'America/Montserrat' | 'America/Nassau' | 'America/New_York' | 'America/Nipigon' | 'America/Nome' | 'America/Noronha' | 'America/North_Dakota/Beulah' | 'America/North_Dakota/Center' | 'America/North_Dakota/New_Salem' | 'America/Nuuk' | 'America/Ojinaga' | 'America/Panama' | 'America/Pangnirtung' | 'America/Paramaribo' | 'America/Phoenix' | 'America/Port-au-Prince' | 'America/Port_of_Spain' | 'America/Porto_Velho' | 'America/Puerto_Rico' | 'America/Punta_Arenas' | 'America/Rainy_River' | 'America/Rankin_Inlet' | 'America/Recife' | 'America/Regina' | 'America/Resolute' | 'America/Rio_Branco' | 'America/Santarem' | 'America/Santiago' | 'America/Santo_Domingo' | 'America/Sao_Paulo' | 'America/Scoresbysund' | 'America/Sitka' | 'America/St_Barthelemy' | 'America/St_Johns' | 'America/St_Kitts' | 'America/St_Lucia' | 'America/St_Thomas' | 'America/St_Vincent' | 'America/Swift_Current' | 'America/Tegucigalpa' | 'America/Thule' | 'America/Thunder_Bay' | 'America/Tijuana' | 'America/Toronto' | 'America/Tortola' | 'America/Vancouver' | 'America/Whitehorse' | 'America/Winnipeg' | 'America/Yakutat' | 'America/Yellowknife' | 'Antarctica/Casey' | 'Antarctica/Davis' | 'Antarctica/DumontDUrville' | 'Antarctica/Macquarie' | 'Antarctica/Mawson' | 'Antarctica/McMurdo' | 'Antarctica/Palmer' | 'Antarctica/Rothera' | 'Antarctica/Syowa' | 'Antarctica/Troll' | 'Antarctica/Vostok' | 'Arctic/Longyearbyen' | 'Asia/Aden' | 'Asia/Almaty' | 'Asia/Amman' | 'Asia/Anadyr' | 'Asia/Aqtau' | 'Asia/Aqtobe' | 'Asia/Ashgabat' | 'Asia/Atyrau' | 'Asia/Baghdad' | 'Asia/Bahrain' | 'Asia/Baku' | 'Asia/Bangkok' | 'Asia/Barnaul' | 'Asia/Beirut' | 'Asia/Bishkek' | 'Asia/Brunei' | 'Asia/Chita' | 'Asia/Choibalsan' | 'Asia/Colombo' | 'Asia/Damascus' | 'Asia/Dhaka' | 'Asia/Dili' | 'Asia/Dubai' | 'Asia/Dushanbe' | 'Asia/Famagusta' | 'Asia/Gaza' | 'Asia/Hebron' | 'Asia/Ho_Chi_Minh' | 'Asia/Hong_Kong' | 'Asia/Hovd' | 'Asia/Irkutsk' | 'Asia/Istanbul' | 'Asia/Jakarta' | 'Asia/Jayapura' | 'Asia/Jerusalem' | 'Asia/Kabul' | 'Asia/Kamchatka' | 'Asia/Karachi' | 'Asia/Kathmandu' | 'Asia/Khandyga' | 'Asia/Kolkata' | 'Asia/Krasnoyarsk' | 'Asia/Kuala_Lumpur' | 'Asia/Kuching' | 'Asia/Kuwait' | 'Asia/Macau' | 'Asia/Magadan' | 'Asia/Makassar' | 'Asia/Manila' | 'Asia/Muscat' | 'Asia/Nicosia' | 'Asia/Novokuznetsk' | 'Asia/Novosibirsk' | 'Asia/Omsk' | 'Asia/Oral' | 'Asia/Phnom_Penh' | 'Asia/Pontianak' | 'Asia/Pyongyang' | 'Asia/Qatar' | 'Asia/Qostanay' | 'Asia/Qyzylorda' | 'Asia/Rangoon' | 'Asia/Riyadh' | 'Asia/Sakhalin' | 'Asia/Samarkand' | 'Asia/Seoul' | 'Asia/Shanghai' | 'Asia/Singapore' | 'Asia/Srednekolymsk' | 'Asia/Taipei' | 'Asia/Tashkent' | 'Asia/Tbilisi' | 'Asia/Tehran' | 'Asia/Thimphu' | 'Asia/Tokyo' | 'Asia/Tomsk' | 'Asia/Ulaanbaatar' | 'Asia/Urumqi' | 'Asia/Ust-Nera' | 'Asia/Vientiane' | 'Asia/Vladivostok' | 'Asia/Yakutsk' | 'Asia/Yangon' | 'Asia/Yekaterinburg' | 'Asia/Yerevan' | 'Atlantic/Azores' | 'Atlantic/Bermuda' | 'Atlantic/Canary' | 'Atlantic/Cape_Verde' | 'Atlantic/Faroe' | 'Atlantic/Madeira' | 'Atlantic/Reykjavik' | 'Atlantic/South_Georgia' | 'Atlantic/St_Helena' | 'Atlantic/Stanley' | 'Australia/Adelaide' | 'Australia/Brisbane' | 'Australia/Broken_Hill' | 'Australia/Currie' | 'Australia/Darwin' | 'Australia/Eucla' | 'Australia/Hobart' | 'Australia/Lindeman' | 'Australia/Lord_Howe' | 'Australia/Melbourne' | 'Australia/Perth' | 'Australia/Sydney' | 'Europe/Amsterdam' | 'Europe/Andorra' | 'Europe/Astrakhan' | 'Europe/Athens' | 'Europe/Belgrade' | 'Europe/Berlin' | 'Europe/Bratislava' | 'Europe/Brussels' | 'Europe/Bucharest' | 'Europe/Budapest' | 'Europe/Busingen' | 'Europe/Chisinau' | 'Europe/Copenhagen' | 'Europe/Dublin' | 'Europe/Gibraltar' | 'Europe/Guernsey' | 'Europe/Helsinki' | 'Europe/Isle_of_Man' | 'Europe/Istanbul' | 'Europe/Jersey' | 'Europe/Kaliningrad' | 'Europe/Kiev' | 'Europe/Kirov' | 'Europe/Lisbon' | 'Europe/Ljubljana' | 'Europe/London' | 'Europe/Luxembourg' | 'Europe/Madrid' | 'Europe/Malta' | 'Europe/Mariehamn' | 'Europe/Minsk' | 'Europe/Monaco' | 'Europe/Moscow' | 'Europe/Nicosia' | 'Europe/Oslo' | 'Europe/Paris' | 'Europe/Podgorica' | 'Europe/Prague' | 'Europe/Riga' | 'Europe/Rome' | 'Europe/Samara' | 'Europe/San_Marino' | 'Europe/Sarajevo' | 'Europe/Saratov' | 'Europe/Simferopol' | 'Europe/Skopje' | 'Europe/Sofia' | 'Europe/Stockholm' | 'Europe/Tallinn' | 'Europe/Tirane' | 'Europe/Ulyanovsk' | 'Europe/Uzhgorod' | 'Europe/Vaduz' | 'Europe/Vatican' | 'Europe/Vienna' | 'Europe/Vilnius' | 'Europe/Volgograd' | 'Europe/Warsaw' | 'Europe/Zagreb' | 'Europe/Zaporozhye' | 'Europe/Zurich' | 'Indian/Antananarivo' | 'Indian/Chagos' | 'Indian/Christmas' | 'Indian/Cocos' | 'Indian/Comoro' | 'Indian/Kerguelen' | 'Indian/Mahe' | 'Indian/Maldives' | 'Indian/Mauritius' | 'Indian/Mayotte' | 'Indian/Reunion' | 'Pacific/Apia' | 'Pacific/Auckland' | 'Pacific/Bougainville' | 'Pacific/Chatham' | 'Pacific/Chuuk' | 'Pacific/Easter' | 'Pacific/Efate' | 'Pacific/Enderbury' | 'Pacific/Fakaofo' | 'Pacific/Fiji' | 'Pacific/Funafuti' | 'Pacific/Galapagos' | 'Pacific/Gambier' | 'Pacific/Guadalcanal' | 'Pacific/Guam' | 'Pacific/Honolulu' | 'Pacific/Kanton' | 'Pacific/Kiritimati' | 'Pacific/Kosrae' | 'Pacific/Kwajalein' | 'Pacific/Majuro' | 'Pacific/Marquesas' | 'Pacific/Midway' | 'Pacific/Nauru' | 'Pacific/Niue' | 'Pacific/Norfolk' | 'Pacific/Noumea' | 'Pacific/Pago_Pago' | 'Pacific/Palau' | 'Pacific/Pitcairn' | 'Pacific/Pohnpei' | 'Pacific/Port_Moresby' | 'Pacific/Rarotonga' | 'Pacific/Saipan' | 'Pacific/Tahiti' | 'Pacific/Tarawa' | 'Pacific/Tongatapu' | 'Pacific/Wake' | 'Pacific/Wallis',
} :
FieldTypeT extends 'rating' ? {
    // the icon name used to display the rating
    icon: 'star' | 'heart' | 'thumbsUp' | 'flag' | 'dot',
    // the maximum value for the rating, from 1 to 10 inclusive
    max: number,
    // the color of selected icons
    color: 'yellowBright' | 'orangeBright' | 'redBright' | 'pinkBright' | 'purpleBright' | 'blueBright' | 'cyanBright' | 'tealBright' | 'greenBright' | 'grayBright',
} :
FieldTypeT extends 'multipleRecordLinks' ? {
    // The ID of the table this field links to
    linkedTableId: TableId,
    // The ID of the view in the linked table to use when showing
    // a list of records to select from
    viewIdForRecordSelection?: ViewId,
    // Note: prefersSingleRecordLink cannot be specified via programmatic field creation
    // and will be false for fields created within an app
} :
null;
declare interface BaseField {
    /**
     * The unique ID of this field.
     */
    readonly id: string;
    /**
     * The name of the field.
     */
    readonly name: string;
    /**
     * The description of this field, if it has one.
     */
    readonly description: string | null;
    /**
     * The type of the field, such as Email, Percent, or Linked Records. See
     * cell values & field options for more information on the available field types.
     */
    readonly type: "singleLineText" | "email" | "url" | "multilineText" | "number" | "percent" | "currency" | "singleSelect" | "multipleSelects" | "singleCollaborator" | "multipleCollaborators" | "multipleRecordLinks" | "date" | "dateTime" | "phoneNumber" | "multipleAttachments" | "checkbox" | "formula" | "createdTime" | "rollup" | "count" | "multipleLookupValues" | "autoNumber" | "barcode" | "rating" | "richText" | "duration" | "lastModifiedTime" | "button" | "createdBy" | "lastModifiedBy" | "externalSyncSource" | "aiText";
    /**
     * The configuration options of the field. The structure of the field's options depend on the field's
     * type. See cell values & field options for the options structure of each field
     * type.
     */
    readonly options: {[key: string]: any} | null;
    /**
     * `true` if this field is computed, `false` otherwise. A field is "computed" if it's value is not
     * set by user input (e.g. autoNumber, formula, etc.).
     */
    readonly isComputed: boolean;
    /**
     * Updates the description for this field.
     * To remove an existing description, pass `''` as the new description.
     * `null` is also accepted and will be coerced to `''` for consistency with field creation.
     * Throws an error if the user does not have permission to update the field, or if invalid description
     * is provided.
     * This action is asynchronous: you must add `await` before each call to this method to ensure it
     * takes effect.
     */
    updateDescriptionAsync(description: string | null): Promise<void>;
    updateOptionsAsync(options: {[key: string]: unknown}, opts?: {enableSelectFieldChoiceDeletion?: boolean}): Promise<void>;
    updateNameAsync(name: string): Promise<void>;
}
declare interface singleLineTextField extends BaseField {
    readonly type: "singleLineText";
    readonly options: null;
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface emailField extends BaseField {
    readonly type: "email";
    readonly options: null;
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface urlField extends BaseField {
    readonly type: "url";
    readonly options: null;
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface multilineTextField extends BaseField {
    readonly type: "multilineText";
    readonly options: null;
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface numberField extends BaseField {
    readonly type: "number";
    readonly options: {
        precision: number, // from 0 to 8 inclusive
    };
    updateOptionsAsync(options: FieldOptionsWriteFormat<"number">): Promise<void>;
}
declare interface percentField extends BaseField {
    readonly type: "percent";
    readonly options: {
        precision: number, // from 0 to 8 inclusive
    };
    updateOptionsAsync(options: FieldOptionsWriteFormat<"percent">): Promise<void>;
}
declare interface currencyField extends BaseField {
    readonly type: "currency";
    readonly options: {
        precision: number, // from 0 to 7 inclusive
        symbol: string,
    };
    updateOptionsAsync(options: FieldOptionsWriteFormat<"currency">): Promise<void>;
}
declare interface singleSelectField extends BaseField {
    readonly type: "singleSelect";
    readonly options: {
        choices: Array<{
            id: string,
            name: string,
            color?: string,
        }>,
    };
    updateOptionsAsync(options: FieldOptionsWriteFormat<"singleSelect">, opts?: {enableSelectFieldChoiceDeletion?: boolean}): Promise<void>;
}
declare interface multipleSelectsField extends BaseField {
    readonly type: "multipleSelects";
    readonly options: {
        choices: Array<{
            id: string,
            name: string,
            color?: string,
        }>,
    };
    updateOptionsAsync(options: FieldOptionsWriteFormat<"multipleSelects">, opts?: {enableSelectFieldChoiceDeletion?: boolean}): Promise<void>;
}
declare interface singleCollaboratorField extends BaseField {
    readonly type: "singleCollaborator";
    readonly options: {
        choices: Array<{
            id: string,
            email: string,
            name?: string,
            profilePicUrl?: string,
        }>,
    };
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface multipleCollaboratorsField extends BaseField {
    readonly type: "multipleCollaborators";
    readonly options: {
        choices: Array<{
            id: string,
            email: string,
            name?: string,
            profilePicUrl?: string,
        }>,
    };
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface multipleRecordLinksField extends BaseField {
    readonly type: "multipleRecordLinks";
    readonly options: {
        // The ID of the table this field links to
        linkedTableId: string,
        // The ID of the field in the linked table that links back
        // to this one
        inverseLinkFieldId?: string,
        // The ID of the view in the linked table to use when showing
        // a list of records to select from
        viewIdForRecordSelection?: string,
        // Whether linked records are rendered in the reverse order from the cell value in the
        // Airtable UI (i.e. most recent first)
        // You generally do not need to rely on this option.
        isReversed: boolean,
        // Whether this field prefers to only have a single linked record. While this preference
        // is enforced in the Airtable UI, it is possible for a field that prefers single linked
        // records to have multiple record links (for example, via copy-and-paste or programmatic
        // updates).
        prefersSingleRecordLink: boolean,
    };
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface dateField extends BaseField {
    readonly type: "date";
    readonly options: {
        dateFormat:
            | {name: 'local', format: 'l'}
            | {name: 'friendly', format: 'LL'}
            | {name: 'us', format: 'M/D/YYYY'}
            | {name: 'european', format: 'D/M/YYYY'}
            | {name: 'iso', format: 'YYYY-MM-DD'}
    };
    updateOptionsAsync(options: FieldOptionsWriteFormat<"date">): Promise<void>;
}
declare interface dateTimeField extends BaseField {
    readonly type: "dateTime";
    readonly options: {
        dateFormat:
            | {name: 'local', format: 'l'}
            | {name: 'friendly', format: 'LL'}
            | {name: 'us', format: 'M/D/YYYY'}
            | {name: 'european', format: 'D/M/YYYY'}
            | {name: 'iso', format: 'YYYY-MM-DD'},
        timeFormat:
            | {name: '12hour', format: 'h:mma'}
            | {name: '24hour', format: 'HH:mm'},
        timeZone: 'utc' | 'client' | 'Africa/Abidjan' | 'Africa/Accra' | 'Africa/Addis_Ababa' | 'Africa/Algiers' | 'Africa/Asmara' | 'Africa/Bamako' | 'Africa/Bangui' | 'Africa/Banjul' | 'Africa/Bissau' | 'Africa/Blantyre' | 'Africa/Brazzaville' | 'Africa/Bujumbura' | 'Africa/Cairo' | 'Africa/Casablanca' | 'Africa/Ceuta' | 'Africa/Conakry' | 'Africa/Dakar' | 'Africa/Dar_es_Salaam' | 'Africa/Djibouti' | 'Africa/Douala' | 'Africa/El_Aaiun' | 'Africa/Freetown' | 'Africa/Gaborone' | 'Africa/Harare' | 'Africa/Johannesburg' | 'Africa/Juba' | 'Africa/Kampala' | 'Africa/Khartoum' | 'Africa/Kigali' | 'Africa/Kinshasa' | 'Africa/Lagos' | 'Africa/Libreville' | 'Africa/Lome' | 'Africa/Luanda' | 'Africa/Lubumbashi' | 'Africa/Lusaka' | 'Africa/Malabo' | 'Africa/Maputo' | 'Africa/Maseru' | 'Africa/Mbabane' | 'Africa/Mogadishu' | 'Africa/Monrovia' | 'Africa/Nairobi' | 'Africa/Ndjamena' | 'Africa/Niamey' | 'Africa/Nouakchott' | 'Africa/Ouagadougou' | 'Africa/Porto-Novo' | 'Africa/Sao_Tome' | 'Africa/Tripoli' | 'Africa/Tunis' | 'Africa/Windhoek' | 'America/Adak' | 'America/Anchorage' | 'America/Anguilla' | 'America/Antigua' | 'America/Araguaina' | 'America/Argentina/Buenos_Aires' | 'America/Argentina/Catamarca' | 'America/Argentina/Cordoba' | 'America/Argentina/Jujuy' | 'America/Argentina/La_Rioja' | 'America/Argentina/Mendoza' | 'America/Argentina/Rio_Gallegos' | 'America/Argentina/Salta' | 'America/Argentina/San_Juan' | 'America/Argentina/San_Luis' | 'America/Argentina/Tucuman' | 'America/Argentina/Ushuaia' | 'America/Aruba' | 'America/Asuncion' | 'America/Atikokan' | 'America/Bahia' | 'America/Bahia_Banderas' | 'America/Barbados' | 'America/Belem' | 'America/Belize' | 'America/Blanc-Sablon' | 'America/Boa_Vista' | 'America/Bogota' | 'America/Boise' | 'America/Cambridge_Bay' | 'America/Campo_Grande' | 'America/Cancun' | 'America/Caracas' | 'America/Cayenne' | 'America/Cayman' | 'America/Chicago' | 'America/Chihuahua' | 'America/Costa_Rica' | 'America/Creston' | 'America/Cuiaba' | 'America/Curacao' | 'America/Danmarkshavn' | 'America/Dawson' | 'America/Dawson_Creek' | 'America/Denver' | 'America/Detroit' | 'America/Dominica' | 'America/Edmonton' | 'America/Eirunepe' | 'America/El_Salvador' | 'America/Fort_Nelson' | 'America/Fortaleza' | 'America/Glace_Bay' | 'America/Godthab' | 'America/Goose_Bay' | 'America/Grand_Turk' | 'America/Grenada' | 'America/Guadeloupe' | 'America/Guatemala' | 'America/Guayaquil' | 'America/Guyana' | 'America/Halifax' | 'America/Havana' | 'America/Hermosillo' | 'America/Indiana/Indianapolis' | 'America/Indiana/Knox' | 'America/Indiana/Marengo' | 'America/Indiana/Petersburg' | 'America/Indiana/Tell_City' | 'America/Indiana/Vevay' | 'America/Indiana/Vincennes' | 'America/Indiana/Winamac' | 'America/Inuvik' | 'America/Iqaluit' | 'America/Jamaica' | 'America/Juneau' | 'America/Kentucky/Louisville' | 'America/Kentucky/Monticello' | 'America/Kralendijk' | 'America/La_Paz' | 'America/Lima' | 'America/Los_Angeles' | 'America/Lower_Princes' | 'America/Maceio' | 'America/Managua' | 'America/Manaus' | 'America/Marigot' | 'America/Martinique' | 'America/Matamoros' | 'America/Mazatlan' | 'America/Menominee' | 'America/Merida' | 'America/Metlakatla' | 'America/Mexico_City' | 'America/Miquelon' | 'America/Moncton' | 'America/Monterrey' | 'America/Montevideo' | 'America/Montserrat' | 'America/Nassau' | 'America/New_York' | 'America/Nipigon' | 'America/Nome' | 'America/Noronha' | 'America/North_Dakota/Beulah' | 'America/North_Dakota/Center' | 'America/North_Dakota/New_Salem' | 'America/Nuuk' | 'America/Ojinaga' | 'America/Panama' | 'America/Pangnirtung' | 'America/Paramaribo' | 'America/Phoenix' | 'America/Port-au-Prince' | 'America/Port_of_Spain' | 'America/Porto_Velho' | 'America/Puerto_Rico' | 'America/Punta_Arenas' | 'America/Rainy_River' | 'America/Rankin_Inlet' | 'America/Recife' | 'America/Regina' | 'America/Resolute' | 'America/Rio_Branco' | 'America/Santarem' | 'America/Santiago' | 'America/Santo_Domingo' | 'America/Sao_Paulo' | 'America/Scoresbysund' | 'America/Sitka' | 'America/St_Barthelemy' | 'America/St_Johns' | 'America/St_Kitts' | 'America/St_Lucia' | 'America/St_Thomas' | 'America/St_Vincent' | 'America/Swift_Current' | 'America/Tegucigalpa' | 'America/Thule' | 'America/Thunder_Bay' | 'America/Tijuana' | 'America/Toronto' | 'America/Tortola' | 'America/Vancouver' | 'America/Whitehorse' | 'America/Winnipeg' | 'America/Yakutat' | 'America/Yellowknife' | 'Antarctica/Casey' | 'Antarctica/Davis' | 'Antarctica/DumontDUrville' | 'Antarctica/Macquarie' | 'Antarctica/Mawson' | 'Antarctica/McMurdo' | 'Antarctica/Palmer' | 'Antarctica/Rothera' | 'Antarctica/Syowa' | 'Antarctica/Troll' | 'Antarctica/Vostok' | 'Arctic/Longyearbyen' | 'Asia/Aden' | 'Asia/Almaty' | 'Asia/Amman' | 'Asia/Anadyr' | 'Asia/Aqtau' | 'Asia/Aqtobe' | 'Asia/Ashgabat' | 'Asia/Atyrau' | 'Asia/Baghdad' | 'Asia/Bahrain' | 'Asia/Baku' | 'Asia/Bangkok' | 'Asia/Barnaul' | 'Asia/Beirut' | 'Asia/Bishkek' | 'Asia/Brunei' | 'Asia/Chita' | 'Asia/Choibalsan' | 'Asia/Colombo' | 'Asia/Damascus' | 'Asia/Dhaka' | 'Asia/Dili' | 'Asia/Dubai' | 'Asia/Dushanbe' | 'Asia/Famagusta' | 'Asia/Gaza' | 'Asia/Hebron' | 'Asia/Ho_Chi_Minh' | 'Asia/Hong_Kong' | 'Asia/Hovd' | 'Asia/Irkutsk' | 'Asia/Istanbul' | 'Asia/Jakarta' | 'Asia/Jayapura' | 'Asia/Jerusalem' | 'Asia/Kabul' | 'Asia/Kamchatka' | 'Asia/Karachi' | 'Asia/Kathmandu' | 'Asia/Khandyga' | 'Asia/Kolkata' | 'Asia/Krasnoyarsk' | 'Asia/Kuala_Lumpur' | 'Asia/Kuching' | 'Asia/Kuwait' | 'Asia/Macau' | 'Asia/Magadan' | 'Asia/Makassar' | 'Asia/Manila' | 'Asia/Muscat' | 'Asia/Nicosia' | 'Asia/Novokuznetsk' | 'Asia/Novosibirsk' | 'Asia/Omsk' | 'Asia/Oral' | 'Asia/Phnom_Penh' | 'Asia/Pontianak' | 'Asia/Pyongyang' | 'Asia/Qatar' | 'Asia/Qostanay' | 'Asia/Qyzylorda' | 'Asia/Rangoon' | 'Asia/Riyadh' | 'Asia/Sakhalin' | 'Asia/Samarkand' | 'Asia/Seoul' | 'Asia/Shanghai' | 'Asia/Singapore' | 'Asia/Srednekolymsk' | 'Asia/Taipei' | 'Asia/Tashkent' | 'Asia/Tbilisi' | 'Asia/Tehran' | 'Asia/Thimphu' | 'Asia/Tokyo' | 'Asia/Tomsk' | 'Asia/Ulaanbaatar' | 'Asia/Urumqi' | 'Asia/Ust-Nera' | 'Asia/Vientiane' | 'Asia/Vladivostok' | 'Asia/Yakutsk' | 'Asia/Yangon' | 'Asia/Yekaterinburg' | 'Asia/Yerevan' | 'Atlantic/Azores' | 'Atlantic/Bermuda' | 'Atlantic/Canary' | 'Atlantic/Cape_Verde' | 'Atlantic/Faroe' | 'Atlantic/Madeira' | 'Atlantic/Reykjavik' | 'Atlantic/South_Georgia' | 'Atlantic/St_Helena' | 'Atlantic/Stanley' | 'Australia/Adelaide' | 'Australia/Brisbane' | 'Australia/Broken_Hill' | 'Australia/Currie' | 'Australia/Darwin' | 'Australia/Eucla' | 'Australia/Hobart' | 'Australia/Lindeman' | 'Australia/Lord_Howe' | 'Australia/Melbourne' | 'Australia/Perth' | 'Australia/Sydney' | 'Europe/Amsterdam' | 'Europe/Andorra' | 'Europe/Astrakhan' | 'Europe/Athens' | 'Europe/Belgrade' | 'Europe/Berlin' | 'Europe/Bratislava' | 'Europe/Brussels' | 'Europe/Bucharest' | 'Europe/Budapest' | 'Europe/Busingen' | 'Europe/Chisinau' | 'Europe/Copenhagen' | 'Europe/Dublin' | 'Europe/Gibraltar' | 'Europe/Guernsey' | 'Europe/Helsinki' | 'Europe/Isle_of_Man' | 'Europe/Istanbul' | 'Europe/Jersey' | 'Europe/Kaliningrad' | 'Europe/Kiev' | 'Europe/Kirov' | 'Europe/Lisbon' | 'Europe/Ljubljana' | 'Europe/London' | 'Europe/Luxembourg' | 'Europe/Madrid' | 'Europe/Malta' | 'Europe/Mariehamn' | 'Europe/Minsk' | 'Europe/Monaco' | 'Europe/Moscow' | 'Europe/Nicosia' | 'Europe/Oslo' | 'Europe/Paris' | 'Europe/Podgorica' | 'Europe/Prague' | 'Europe/Riga' | 'Europe/Rome' | 'Europe/Samara' | 'Europe/San_Marino' | 'Europe/Sarajevo' | 'Europe/Saratov' | 'Europe/Simferopol' | 'Europe/Skopje' | 'Europe/Sofia' | 'Europe/Stockholm' | 'Europe/Tallinn' | 'Europe/Tirane' | 'Europe/Ulyanovsk' | 'Europe/Uzhgorod' | 'Europe/Vaduz' | 'Europe/Vatican' | 'Europe/Vienna' | 'Europe/Vilnius' | 'Europe/Volgograd' | 'Europe/Warsaw' | 'Europe/Zagreb' | 'Europe/Zaporozhye' | 'Europe/Zurich' | 'Indian/Antananarivo' | 'Indian/Chagos' | 'Indian/Christmas' | 'Indian/Cocos' | 'Indian/Comoro' | 'Indian/Kerguelen' | 'Indian/Mahe' | 'Indian/Maldives' | 'Indian/Mauritius' | 'Indian/Mayotte' | 'Indian/Reunion' | 'Pacific/Apia' | 'Pacific/Auckland' | 'Pacific/Bougainville' | 'Pacific/Chatham' | 'Pacific/Chuuk' | 'Pacific/Easter' | 'Pacific/Efate' | 'Pacific/Enderbury' | 'Pacific/Fakaofo' | 'Pacific/Fiji' | 'Pacific/Funafuti' | 'Pacific/Galapagos' | 'Pacific/Gambier' | 'Pacific/Guadalcanal' | 'Pacific/Guam' | 'Pacific/Honolulu' | 'Pacific/Kanton' | 'Pacific/Kiritimati' | 'Pacific/Kosrae' | 'Pacific/Kwajalein' | 'Pacific/Majuro' | 'Pacific/Marquesas' | 'Pacific/Midway' | 'Pacific/Nauru' | 'Pacific/Niue' | 'Pacific/Norfolk' | 'Pacific/Noumea' | 'Pacific/Pago_Pago' | 'Pacific/Palau' | 'Pacific/Pitcairn' | 'Pacific/Pohnpei' | 'Pacific/Port_Moresby' | 'Pacific/Rarotonga' | 'Pacific/Saipan' | 'Pacific/Tahiti' | 'Pacific/Tarawa' | 'Pacific/Tongatapu' | 'Pacific/Wake' | 'Pacific/Wallis',
    };
    updateOptionsAsync(options: FieldOptionsWriteFormat<"dateTime">): Promise<void>;
}
declare interface phoneNumberField extends BaseField {
    readonly type: "phoneNumber";
    readonly options: null;
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface multipleAttachmentsField extends BaseField {
    readonly type: "multipleAttachments";
    readonly options: {
        // Whether attachments are rendered in the reverse order from the cell value in the
        // Airtable UI (i.e. most recent first)
        // You generally do not need to rely on this option.
        isReversed: boolean,
    };
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface checkboxField extends BaseField {
    readonly type: "checkbox";
    readonly options: {
        // an icon name
        icon: 'check' | 'star' | 'heart' | 'thumbsUp' | 'flag' | 'dot',
        // the color of the check box
        color: 'yellowBright' | 'orangeBright' | 'redBright' | 'pinkBright' | 'purpleBright' | 'blueBright' | 'cyanBright' | 'tealBright' | 'greenBright' | 'grayBright' ,
    };
    updateOptionsAsync(options: FieldOptionsWriteFormat<"checkbox">): Promise<void>;
}
declare interface formulaField extends BaseField {
    readonly type: "formula";
    readonly options: {
        // false if the formula contains an error
        isValid: boolean,
        // the other fields in the record that are used in the formula
        referencedFieldIds: Array<string>,
        // the resulting field type and options returned by the formula
        result: {
            // the field type of the formula result
            type: string,
            // that types options
            options?: any,
        },
    };
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface createdTimeField extends BaseField {
    readonly type: "createdTime";
    readonly options: {
        result:
          | {
                type: 'date',
                options: {
                    dateFormat:
                        | {name: 'local', format: 'l'}
                        | {name: 'friendly', format: 'LL'}
                        | {name: 'us', format: 'M/D/YYYY'}
                        | {name: 'european', format: 'D/M/YYYY'}
                        | {name: 'iso', format: 'YYYY-MM-DD'}
                },
            }
          | {
                type: 'dateTime',
                options: {
                    dateFormat:
                        | {name: 'local', format: 'l'}
                        | {name: 'friendly', format: 'LL'}
                        | {name: 'us', format: 'M/D/YYYY'}
                        | {name: 'european', format: 'D/M/YYYY'}
                        | {name: 'iso', format: 'YYYY-MM-DD'},
                    timeFormat:
                        | {name: '12hour', format: 'h:mma'}
                        | {name: '24hour', format: 'HH:mm'},
                    timeZone: 'utc' | 'client' | 'Africa/Abidjan' | 'Africa/Accra' | 'Africa/Addis_Ababa' | 'Africa/Algiers' | 'Africa/Asmara' | 'Africa/Bamako' | 'Africa/Bangui' | 'Africa/Banjul' | 'Africa/Bissau' | 'Africa/Blantyre' | 'Africa/Brazzaville' | 'Africa/Bujumbura' | 'Africa/Cairo' | 'Africa/Casablanca' | 'Africa/Ceuta' | 'Africa/Conakry' | 'Africa/Dakar' | 'Africa/Dar_es_Salaam' | 'Africa/Djibouti' | 'Africa/Douala' | 'Africa/El_Aaiun' | 'Africa/Freetown' | 'Africa/Gaborone' | 'Africa/Harare' | 'Africa/Johannesburg' | 'Africa/Juba' | 'Africa/Kampala' | 'Africa/Khartoum' | 'Africa/Kigali' | 'Africa/Kinshasa' | 'Africa/Lagos' | 'Africa/Libreville' | 'Africa/Lome' | 'Africa/Luanda' | 'Africa/Lubumbashi' | 'Africa/Lusaka' | 'Africa/Malabo' | 'Africa/Maputo' | 'Africa/Maseru' | 'Africa/Mbabane' | 'Africa/Mogadishu' | 'Africa/Monrovia' | 'Africa/Nairobi' | 'Africa/Ndjamena' | 'Africa/Niamey' | 'Africa/Nouakchott' | 'Africa/Ouagadougou' | 'Africa/Porto-Novo' | 'Africa/Sao_Tome' | 'Africa/Tripoli' | 'Africa/Tunis' | 'Africa/Windhoek' | 'America/Adak' | 'America/Anchorage' | 'America/Anguilla' | 'America/Antigua' | 'America/Araguaina' | 'America/Argentina/Buenos_Aires' | 'America/Argentina/Catamarca' | 'America/Argentina/Cordoba' | 'America/Argentina/Jujuy' | 'America/Argentina/La_Rioja' | 'America/Argentina/Mendoza' | 'America/Argentina/Rio_Gallegos' | 'America/Argentina/Salta' | 'America/Argentina/San_Juan' | 'America/Argentina/San_Luis' | 'America/Argentina/Tucuman' | 'America/Argentina/Ushuaia' | 'America/Aruba' | 'America/Asuncion' | 'America/Atikokan' | 'America/Bahia' | 'America/Bahia_Banderas' | 'America/Barbados' | 'America/Belem' | 'America/Belize' | 'America/Blanc-Sablon' | 'America/Boa_Vista' | 'America/Bogota' | 'America/Boise' | 'America/Cambridge_Bay' | 'America/Campo_Grande' | 'America/Cancun' | 'America/Caracas' | 'America/Cayenne' | 'America/Cayman' | 'America/Chicago' | 'America/Chihuahua' | 'America/Costa_Rica' | 'America/Creston' | 'America/Cuiaba' | 'America/Curacao' | 'America/Danmarkshavn' | 'America/Dawson' | 'America/Dawson_Creek' | 'America/Denver' | 'America/Detroit' | 'America/Dominica' | 'America/Edmonton' | 'America/Eirunepe' | 'America/El_Salvador' | 'America/Fort_Nelson' | 'America/Fortaleza' | 'America/Glace_Bay' | 'America/Godthab' | 'America/Goose_Bay' | 'America/Grand_Turk' | 'America/Grenada' | 'America/Guadeloupe' | 'America/Guatemala' | 'America/Guayaquil' | 'America/Guyana' | 'America/Halifax' | 'America/Havana' | 'America/Hermosillo' | 'America/Indiana/Indianapolis' | 'America/Indiana/Knox' | 'America/Indiana/Marengo' | 'America/Indiana/Petersburg' | 'America/Indiana/Tell_City' | 'America/Indiana/Vevay' | 'America/Indiana/Vincennes' | 'America/Indiana/Winamac' | 'America/Inuvik' | 'America/Iqaluit' | 'America/Jamaica' | 'America/Juneau' | 'America/Kentucky/Louisville' | 'America/Kentucky/Monticello' | 'America/Kralendijk' | 'America/La_Paz' | 'America/Lima' | 'America/Los_Angeles' | 'America/Lower_Princes' | 'America/Maceio' | 'America/Managua' | 'America/Manaus' | 'America/Marigot' | 'America/Martinique' | 'America/Matamoros' | 'America/Mazatlan' | 'America/Menominee' | 'America/Merida' | 'America/Metlakatla' | 'America/Mexico_City' | 'America/Miquelon' | 'America/Moncton' | 'America/Monterrey' | 'America/Montevideo' | 'America/Montserrat' | 'America/Nassau' | 'America/New_York' | 'America/Nipigon' | 'America/Nome' | 'America/Noronha' | 'America/North_Dakota/Beulah' | 'America/North_Dakota/Center' | 'America/North_Dakota/New_Salem' | 'America/Nuuk' | 'America/Ojinaga' | 'America/Panama' | 'America/Pangnirtung' | 'America/Paramaribo' | 'America/Phoenix' | 'America/Port-au-Prince' | 'America/Port_of_Spain' | 'America/Porto_Velho' | 'America/Puerto_Rico' | 'America/Punta_Arenas' | 'America/Rainy_River' | 'America/Rankin_Inlet' | 'America/Recife' | 'America/Regina' | 'America/Resolute' | 'America/Rio_Branco' | 'America/Santarem' | 'America/Santiago' | 'America/Santo_Domingo' | 'America/Sao_Paulo' | 'America/Scoresbysund' | 'America/Sitka' | 'America/St_Barthelemy' | 'America/St_Johns' | 'America/St_Kitts' | 'America/St_Lucia' | 'America/St_Thomas' | 'America/St_Vincent' | 'America/Swift_Current' | 'America/Tegucigalpa' | 'America/Thule' | 'America/Thunder_Bay' | 'America/Tijuana' | 'America/Toronto' | 'America/Tortola' | 'America/Vancouver' | 'America/Whitehorse' | 'America/Winnipeg' | 'America/Yakutat' | 'America/Yellowknife' | 'Antarctica/Casey' | 'Antarctica/Davis' | 'Antarctica/DumontDUrville' | 'Antarctica/Macquarie' | 'Antarctica/Mawson' | 'Antarctica/McMurdo' | 'Antarctica/Palmer' | 'Antarctica/Rothera' | 'Antarctica/Syowa' | 'Antarctica/Troll' | 'Antarctica/Vostok' | 'Arctic/Longyearbyen' | 'Asia/Aden' | 'Asia/Almaty' | 'Asia/Amman' | 'Asia/Anadyr' | 'Asia/Aqtau' | 'Asia/Aqtobe' | 'Asia/Ashgabat' | 'Asia/Atyrau' | 'Asia/Baghdad' | 'Asia/Bahrain' | 'Asia/Baku' | 'Asia/Bangkok' | 'Asia/Barnaul' | 'Asia/Beirut' | 'Asia/Bishkek' | 'Asia/Brunei' | 'Asia/Chita' | 'Asia/Choibalsan' | 'Asia/Colombo' | 'Asia/Damascus' | 'Asia/Dhaka' | 'Asia/Dili' | 'Asia/Dubai' | 'Asia/Dushanbe' | 'Asia/Famagusta' | 'Asia/Gaza' | 'Asia/Hebron' | 'Asia/Ho_Chi_Minh' | 'Asia/Hong_Kong' | 'Asia/Hovd' | 'Asia/Irkutsk' | 'Asia/Istanbul' | 'Asia/Jakarta' | 'Asia/Jayapura' | 'Asia/Jerusalem' | 'Asia/Kabul' | 'Asia/Kamchatka' | 'Asia/Karachi' | 'Asia/Kathmandu' | 'Asia/Khandyga' | 'Asia/Kolkata' | 'Asia/Krasnoyarsk' | 'Asia/Kuala_Lumpur' | 'Asia/Kuching' | 'Asia/Kuwait' | 'Asia/Macau' | 'Asia/Magadan' | 'Asia/Makassar' | 'Asia/Manila' | 'Asia/Muscat' | 'Asia/Nicosia' | 'Asia/Novokuznetsk' | 'Asia/Novosibirsk' | 'Asia/Omsk' | 'Asia/Oral' | 'Asia/Phnom_Penh' | 'Asia/Pontianak' | 'Asia/Pyongyang' | 'Asia/Qatar' | 'Asia/Qostanay' | 'Asia/Qyzylorda' | 'Asia/Rangoon' | 'Asia/Riyadh' | 'Asia/Sakhalin' | 'Asia/Samarkand' | 'Asia/Seoul' | 'Asia/Shanghai' | 'Asia/Singapore' | 'Asia/Srednekolymsk' | 'Asia/Taipei' | 'Asia/Tashkent' | 'Asia/Tbilisi' | 'Asia/Tehran' | 'Asia/Thimphu' | 'Asia/Tokyo' | 'Asia/Tomsk' | 'Asia/Ulaanbaatar' | 'Asia/Urumqi' | 'Asia/Ust-Nera' | 'Asia/Vientiane' | 'Asia/Vladivostok' | 'Asia/Yakutsk' | 'Asia/Yangon' | 'Asia/Yekaterinburg' | 'Asia/Yerevan' | 'Atlantic/Azores' | 'Atlantic/Bermuda' | 'Atlantic/Canary' | 'Atlantic/Cape_Verde' | 'Atlantic/Faroe' | 'Atlantic/Madeira' | 'Atlantic/Reykjavik' | 'Atlantic/South_Georgia' | 'Atlantic/St_Helena' | 'Atlantic/Stanley' | 'Australia/Adelaide' | 'Australia/Brisbane' | 'Australia/Broken_Hill' | 'Australia/Currie' | 'Australia/Darwin' | 'Australia/Eucla' | 'Australia/Hobart' | 'Australia/Lindeman' | 'Australia/Lord_Howe' | 'Australia/Melbourne' | 'Australia/Perth' | 'Australia/Sydney' | 'Europe/Amsterdam' | 'Europe/Andorra' | 'Europe/Astrakhan' | 'Europe/Athens' | 'Europe/Belgrade' | 'Europe/Berlin' | 'Europe/Bratislava' | 'Europe/Brussels' | 'Europe/Bucharest' | 'Europe/Budapest' | 'Europe/Busingen' | 'Europe/Chisinau' | 'Europe/Copenhagen' | 'Europe/Dublin' | 'Europe/Gibraltar' | 'Europe/Guernsey' | 'Europe/Helsinki' | 'Europe/Isle_of_Man' | 'Europe/Istanbul' | 'Europe/Jersey' | 'Europe/Kaliningrad' | 'Europe/Kiev' | 'Europe/Kirov' | 'Europe/Lisbon' | 'Europe/Ljubljana' | 'Europe/London' | 'Europe/Luxembourg' | 'Europe/Madrid' | 'Europe/Malta' | 'Europe/Mariehamn' | 'Europe/Minsk' | 'Europe/Monaco' | 'Europe/Moscow' | 'Europe/Nicosia' | 'Europe/Oslo' | 'Europe/Paris' | 'Europe/Podgorica' | 'Europe/Prague' | 'Europe/Riga' | 'Europe/Rome' | 'Europe/Samara' | 'Europe/San_Marino' | 'Europe/Sarajevo' | 'Europe/Saratov' | 'Europe/Simferopol' | 'Europe/Skopje' | 'Europe/Sofia' | 'Europe/Stockholm' | 'Europe/Tallinn' | 'Europe/Tirane' | 'Europe/Ulyanovsk' | 'Europe/Uzhgorod' | 'Europe/Vaduz' | 'Europe/Vatican' | 'Europe/Vienna' | 'Europe/Vilnius' | 'Europe/Volgograd' | 'Europe/Warsaw' | 'Europe/Zagreb' | 'Europe/Zaporozhye' | 'Europe/Zurich' | 'Indian/Antananarivo' | 'Indian/Chagos' | 'Indian/Christmas' | 'Indian/Cocos' | 'Indian/Comoro' | 'Indian/Kerguelen' | 'Indian/Mahe' | 'Indian/Maldives' | 'Indian/Mauritius' | 'Indian/Mayotte' | 'Indian/Reunion' | 'Pacific/Apia' | 'Pacific/Auckland' | 'Pacific/Bougainville' | 'Pacific/Chatham' | 'Pacific/Chuuk' | 'Pacific/Easter' | 'Pacific/Efate' | 'Pacific/Enderbury' | 'Pacific/Fakaofo' | 'Pacific/Fiji' | 'Pacific/Funafuti' | 'Pacific/Galapagos' | 'Pacific/Gambier' | 'Pacific/Guadalcanal' | 'Pacific/Guam' | 'Pacific/Honolulu' | 'Pacific/Kanton' | 'Pacific/Kiritimati' | 'Pacific/Kosrae' | 'Pacific/Kwajalein' | 'Pacific/Majuro' | 'Pacific/Marquesas' | 'Pacific/Midway' | 'Pacific/Nauru' | 'Pacific/Niue' | 'Pacific/Norfolk' | 'Pacific/Noumea' | 'Pacific/Pago_Pago' | 'Pacific/Palau' | 'Pacific/Pitcairn' | 'Pacific/Pohnpei' | 'Pacific/Port_Moresby' | 'Pacific/Rarotonga' | 'Pacific/Saipan' | 'Pacific/Tahiti' | 'Pacific/Tarawa' | 'Pacific/Tongatapu' | 'Pacific/Wake' | 'Pacific/Wallis',
                },
            }
    };
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface rollupField extends BaseField {
    readonly type: "rollup";
    readonly options: {
        // false if the formula contains an error
        isValid: boolean,
        // the linked record field in this table that this field is
        // summarizing.
        recordLinkFieldId: string,
        // the field id in the linked table that this field is summarizing.
        fieldIdInLinkedTable: string,
        // the other fields in the record that are used in the formula
        referencedFieldIds: Array<string>,
        // the resulting field type and options returned by the formula
        result: {
            // the field type of the formula result
            type: string,
            // that types options
            options?: any,
        },
    };
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface countField extends BaseField {
    readonly type: "count";
    readonly options: {
        // is the field currently valid (e.g. false if the linked record
        // field has been changed to a different field type)
        isValid: boolean,
        // the linked record field in this table that we're counting
        recordLinkFieldId: string,
    };
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface multipleLookupValuesField extends BaseField {
    readonly type: "multipleLookupValues";
    readonly options: {
        // The field in the linked table that this field is looking up
        fieldIdInLinkedTable: string,
        // is the field currently valid (e.g. false if the linked record field has
        // been deleted)
        isValid: boolean,
        // The linked record field in the current table
        recordLinkFieldId: string,
        result: {
            // The type of the field in the linked table
            type: string,
            // For field options, refer to the section for the relevant field type
            options?: object,
        },
    };
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface autoNumberField extends BaseField {
    readonly type: "autoNumber";
    readonly options: null;
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface barcodeField extends BaseField {
    readonly type: "barcode";
    readonly options: null;
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface ratingField extends BaseField {
    readonly type: "rating";
    readonly options: {
        // the icon name used to display the rating
        icon: 'star' | 'heart' | 'thumbsUp' | 'flag' | 'dot',
        // the maximum value for the rating, from 1 to 10 inclusive
        max: number,
        // the color of selected icons
        color: 'yellowBright' | 'orangeBright' | 'redBright' | 'pinkBright' | 'purpleBright' | 'blueBright' | 'cyanBright' | 'tealBright' | 'greenBright' | 'grayBright',
    };
    updateOptionsAsync(options: FieldOptionsWriteFormat<"rating">): Promise<void>;
}
declare interface richTextField extends BaseField {
    readonly type: "richText";
    readonly options: null;
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface durationField extends BaseField {
    readonly type: "duration";
    readonly options: {
        durationFormat: 'h:mm' | 'h:mm:ss' | 'h:mm:ss.S' | 'h:mm:ss.SS' | 'h:mm:ss.SSS'
    };
    updateOptionsAsync(options: FieldOptionsWriteFormat<"duration">): Promise<void>;
}
declare interface lastModifiedTimeField extends BaseField {
    readonly type: "lastModifiedTime";
    readonly options: {
        // false if the formula contains an error
        isValid: boolean,
        // the fields to check the last modified time of
        referencedFieldIds: Array<string>,
        // the cell value result type
        result:
        | {
            type: 'date',
            options: {
                dateFormat:
                    | {name: 'local', format: 'l'}
                    | {name: 'friendly', format: 'LL'}
                    | {name: 'us', format: 'M/D/YYYY'}
                    | {name: 'european', format: 'D/M/YYYY'}
                    | {name: 'iso', format: 'YYYY-MM-DD'},
            },
        }
        | {
            type: 'dateTime',
            options: {
                dateFormat:
                    | {name: 'local', format: 'l'}
                    | {name: 'friendly', format: 'LL'}
                    | {name: 'us', format: 'M/D/YYYY'}
                    | {name: 'european', format: 'D/M/YYYY'}
                    | {name: 'iso', format: 'YYYY-MM-DD'},
                timeFormat:
                    | {name: '12hour', format: 'h:mma'}
                    | {name: '24hour', format: 'HH:mm'},
                timeZone: 'utc' | 'client' | 'Africa/Abidjan' | 'Africa/Accra' | 'Africa/Addis_Ababa' | 'Africa/Algiers' | 'Africa/Asmara' | 'Africa/Bamako' | 'Africa/Bangui' | 'Africa/Banjul' | 'Africa/Bissau' | 'Africa/Blantyre' | 'Africa/Brazzaville' | 'Africa/Bujumbura' | 'Africa/Cairo' | 'Africa/Casablanca' | 'Africa/Ceuta' | 'Africa/Conakry' | 'Africa/Dakar' | 'Africa/Dar_es_Salaam' | 'Africa/Djibouti' | 'Africa/Douala' | 'Africa/El_Aaiun' | 'Africa/Freetown' | 'Africa/Gaborone' | 'Africa/Harare' | 'Africa/Johannesburg' | 'Africa/Juba' | 'Africa/Kampala' | 'Africa/Khartoum' | 'Africa/Kigali' | 'Africa/Kinshasa' | 'Africa/Lagos' | 'Africa/Libreville' | 'Africa/Lome' | 'Africa/Luanda' | 'Africa/Lubumbashi' | 'Africa/Lusaka' | 'Africa/Malabo' | 'Africa/Maputo' | 'Africa/Maseru' | 'Africa/Mbabane' | 'Africa/Mogadishu' | 'Africa/Monrovia' | 'Africa/Nairobi' | 'Africa/Ndjamena' | 'Africa/Niamey' | 'Africa/Nouakchott' | 'Africa/Ouagadougou' | 'Africa/Porto-Novo' | 'Africa/Sao_Tome' | 'Africa/Tripoli' | 'Africa/Tunis' | 'Africa/Windhoek' | 'America/Adak' | 'America/Anchorage' | 'America/Anguilla' | 'America/Antigua' | 'America/Araguaina' | 'America/Argentina/Buenos_Aires' | 'America/Argentina/Catamarca' | 'America/Argentina/Cordoba' | 'America/Argentina/Jujuy' | 'America/Argentina/La_Rioja' | 'America/Argentina/Mendoza' | 'America/Argentina/Rio_Gallegos' | 'America/Argentina/Salta' | 'America/Argentina/San_Juan' | 'America/Argentina/San_Luis' | 'America/Argentina/Tucuman' | 'America/Argentina/Ushuaia' | 'America/Aruba' | 'America/Asuncion' | 'America/Atikokan' | 'America/Bahia' | 'America/Bahia_Banderas' | 'America/Barbados' | 'America/Belem' | 'America/Belize' | 'America/Blanc-Sablon' | 'America/Boa_Vista' | 'America/Bogota' | 'America/Boise' | 'America/Cambridge_Bay' | 'America/Campo_Grande' | 'America/Cancun' | 'America/Caracas' | 'America/Cayenne' | 'America/Cayman' | 'America/Chicago' | 'America/Chihuahua' | 'America/Costa_Rica' | 'America/Creston' | 'America/Cuiaba' | 'America/Curacao' | 'America/Danmarkshavn' | 'America/Dawson' | 'America/Dawson_Creek' | 'America/Denver' | 'America/Detroit' | 'America/Dominica' | 'America/Edmonton' | 'America/Eirunepe' | 'America/El_Salvador' | 'America/Fort_Nelson' | 'America/Fortaleza' | 'America/Glace_Bay' | 'America/Godthab' | 'America/Goose_Bay' | 'America/Grand_Turk' | 'America/Grenada' | 'America/Guadeloupe' | 'America/Guatemala' | 'America/Guayaquil' | 'America/Guyana' | 'America/Halifax' | 'America/Havana' | 'America/Hermosillo' | 'America/Indiana/Indianapolis' | 'America/Indiana/Knox' | 'America/Indiana/Marengo' | 'America/Indiana/Petersburg' | 'America/Indiana/Tell_City' | 'America/Indiana/Vevay' | 'America/Indiana/Vincennes' | 'America/Indiana/Winamac' | 'America/Inuvik' | 'America/Iqaluit' | 'America/Jamaica' | 'America/Juneau' | 'America/Kentucky/Louisville' | 'America/Kentucky/Monticello' | 'America/Kralendijk' | 'America/La_Paz' | 'America/Lima' | 'America/Los_Angeles' | 'America/Lower_Princes' | 'America/Maceio' | 'America/Managua' | 'America/Manaus' | 'America/Marigot' | 'America/Martinique' | 'America/Matamoros' | 'America/Mazatlan' | 'America/Menominee' | 'America/Merida' | 'America/Metlakatla' | 'America/Mexico_City' | 'America/Miquelon' | 'America/Moncton' | 'America/Monterrey' | 'America/Montevideo' | 'America/Montserrat' | 'America/Nassau' | 'America/New_York' | 'America/Nipigon' | 'America/Nome' | 'America/Noronha' | 'America/North_Dakota/Beulah' | 'America/North_Dakota/Center' | 'America/North_Dakota/New_Salem' | 'America/Nuuk' | 'America/Ojinaga' | 'America/Panama' | 'America/Pangnirtung' | 'America/Paramaribo' | 'America/Phoenix' | 'America/Port-au-Prince' | 'America/Port_of_Spain' | 'America/Porto_Velho' | 'America/Puerto_Rico' | 'America/Punta_Arenas' | 'America/Rainy_River' | 'America/Rankin_Inlet' | 'America/Recife' | 'America/Regina' | 'America/Resolute' | 'America/Rio_Branco' | 'America/Santarem' | 'America/Santiago' | 'America/Santo_Domingo' | 'America/Sao_Paulo' | 'America/Scoresbysund' | 'America/Sitka' | 'America/St_Barthelemy' | 'America/St_Johns' | 'America/St_Kitts' | 'America/St_Lucia' | 'America/St_Thomas' | 'America/St_Vincent' | 'America/Swift_Current' | 'America/Tegucigalpa' | 'America/Thule' | 'America/Thunder_Bay' | 'America/Tijuana' | 'America/Toronto' | 'America/Tortola' | 'America/Vancouver' | 'America/Whitehorse' | 'America/Winnipeg' | 'America/Yakutat' | 'America/Yellowknife' | 'Antarctica/Casey' | 'Antarctica/Davis' | 'Antarctica/DumontDUrville' | 'Antarctica/Macquarie' | 'Antarctica/Mawson' | 'Antarctica/McMurdo' | 'Antarctica/Palmer' | 'Antarctica/Rothera' | 'Antarctica/Syowa' | 'Antarctica/Troll' | 'Antarctica/Vostok' | 'Arctic/Longyearbyen' | 'Asia/Aden' | 'Asia/Almaty' | 'Asia/Amman' | 'Asia/Anadyr' | 'Asia/Aqtau' | 'Asia/Aqtobe' | 'Asia/Ashgabat' | 'Asia/Atyrau' | 'Asia/Baghdad' | 'Asia/Bahrain' | 'Asia/Baku' | 'Asia/Bangkok' | 'Asia/Barnaul' | 'Asia/Beirut' | 'Asia/Bishkek' | 'Asia/Brunei' | 'Asia/Chita' | 'Asia/Choibalsan' | 'Asia/Colombo' | 'Asia/Damascus' | 'Asia/Dhaka' | 'Asia/Dili' | 'Asia/Dubai' | 'Asia/Dushanbe' | 'Asia/Famagusta' | 'Asia/Gaza' | 'Asia/Hebron' | 'Asia/Ho_Chi_Minh' | 'Asia/Hong_Kong' | 'Asia/Hovd' | 'Asia/Irkutsk' | 'Asia/Istanbul' | 'Asia/Jakarta' | 'Asia/Jayapura' | 'Asia/Jerusalem' | 'Asia/Kabul' | 'Asia/Kamchatka' | 'Asia/Karachi' | 'Asia/Kathmandu' | 'Asia/Khandyga' | 'Asia/Kolkata' | 'Asia/Krasnoyarsk' | 'Asia/Kuala_Lumpur' | 'Asia/Kuching' | 'Asia/Kuwait' | 'Asia/Macau' | 'Asia/Magadan' | 'Asia/Makassar' | 'Asia/Manila' | 'Asia/Muscat' | 'Asia/Nicosia' | 'Asia/Novokuznetsk' | 'Asia/Novosibirsk' | 'Asia/Omsk' | 'Asia/Oral' | 'Asia/Phnom_Penh' | 'Asia/Pontianak' | 'Asia/Pyongyang' | 'Asia/Qatar' | 'Asia/Qostanay' | 'Asia/Qyzylorda' | 'Asia/Rangoon' | 'Asia/Riyadh' | 'Asia/Sakhalin' | 'Asia/Samarkand' | 'Asia/Seoul' | 'Asia/Shanghai' | 'Asia/Singapore' | 'Asia/Srednekolymsk' | 'Asia/Taipei' | 'Asia/Tashkent' | 'Asia/Tbilisi' | 'Asia/Tehran' | 'Asia/Thimphu' | 'Asia/Tokyo' | 'Asia/Tomsk' | 'Asia/Ulaanbaatar' | 'Asia/Urumqi' | 'Asia/Ust-Nera' | 'Asia/Vientiane' | 'Asia/Vladivostok' | 'Asia/Yakutsk' | 'Asia/Yangon' | 'Asia/Yekaterinburg' | 'Asia/Yerevan' | 'Atlantic/Azores' | 'Atlantic/Bermuda' | 'Atlantic/Canary' | 'Atlantic/Cape_Verde' | 'Atlantic/Faroe' | 'Atlantic/Madeira' | 'Atlantic/Reykjavik' | 'Atlantic/South_Georgia' | 'Atlantic/St_Helena' | 'Atlantic/Stanley' | 'Australia/Adelaide' | 'Australia/Brisbane' | 'Australia/Broken_Hill' | 'Australia/Currie' | 'Australia/Darwin' | 'Australia/Eucla' | 'Australia/Hobart' | 'Australia/Lindeman' | 'Australia/Lord_Howe' | 'Australia/Melbourne' | 'Australia/Perth' | 'Australia/Sydney' | 'Europe/Amsterdam' | 'Europe/Andorra' | 'Europe/Astrakhan' | 'Europe/Athens' | 'Europe/Belgrade' | 'Europe/Berlin' | 'Europe/Bratislava' | 'Europe/Brussels' | 'Europe/Bucharest' | 'Europe/Budapest' | 'Europe/Busingen' | 'Europe/Chisinau' | 'Europe/Copenhagen' | 'Europe/Dublin' | 'Europe/Gibraltar' | 'Europe/Guernsey' | 'Europe/Helsinki' | 'Europe/Isle_of_Man' | 'Europe/Istanbul' | 'Europe/Jersey' | 'Europe/Kaliningrad' | 'Europe/Kiev' | 'Europe/Kirov' | 'Europe/Lisbon' | 'Europe/Ljubljana' | 'Europe/London' | 'Europe/Luxembourg' | 'Europe/Madrid' | 'Europe/Malta' | 'Europe/Mariehamn' | 'Europe/Minsk' | 'Europe/Monaco' | 'Europe/Moscow' | 'Europe/Nicosia' | 'Europe/Oslo' | 'Europe/Paris' | 'Europe/Podgorica' | 'Europe/Prague' | 'Europe/Riga' | 'Europe/Rome' | 'Europe/Samara' | 'Europe/San_Marino' | 'Europe/Sarajevo' | 'Europe/Saratov' | 'Europe/Simferopol' | 'Europe/Skopje' | 'Europe/Sofia' | 'Europe/Stockholm' | 'Europe/Tallinn' | 'Europe/Tirane' | 'Europe/Ulyanovsk' | 'Europe/Uzhgorod' | 'Europe/Vaduz' | 'Europe/Vatican' | 'Europe/Vienna' | 'Europe/Vilnius' | 'Europe/Volgograd' | 'Europe/Warsaw' | 'Europe/Zagreb' | 'Europe/Zaporozhye' | 'Europe/Zurich' | 'Indian/Antananarivo' | 'Indian/Chagos' | 'Indian/Christmas' | 'Indian/Cocos' | 'Indian/Comoro' | 'Indian/Kerguelen' | 'Indian/Mahe' | 'Indian/Maldives' | 'Indian/Mauritius' | 'Indian/Mayotte' | 'Indian/Reunion' | 'Pacific/Apia' | 'Pacific/Auckland' | 'Pacific/Bougainville' | 'Pacific/Chatham' | 'Pacific/Chuuk' | 'Pacific/Easter' | 'Pacific/Efate' | 'Pacific/Enderbury' | 'Pacific/Fakaofo' | 'Pacific/Fiji' | 'Pacific/Funafuti' | 'Pacific/Galapagos' | 'Pacific/Gambier' | 'Pacific/Guadalcanal' | 'Pacific/Guam' | 'Pacific/Honolulu' | 'Pacific/Kanton' | 'Pacific/Kiritimati' | 'Pacific/Kosrae' | 'Pacific/Kwajalein' | 'Pacific/Majuro' | 'Pacific/Marquesas' | 'Pacific/Midway' | 'Pacific/Nauru' | 'Pacific/Niue' | 'Pacific/Norfolk' | 'Pacific/Noumea' | 'Pacific/Pago_Pago' | 'Pacific/Palau' | 'Pacific/Pitcairn' | 'Pacific/Pohnpei' | 'Pacific/Port_Moresby' | 'Pacific/Rarotonga' | 'Pacific/Saipan' | 'Pacific/Tahiti' | 'Pacific/Tarawa' | 'Pacific/Tongatapu' | 'Pacific/Wake' | 'Pacific/Wallis',
            },
        }
    };
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface buttonField extends BaseField {
    readonly type: "button";
    readonly options: null;
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface createdByField extends BaseField {
    readonly type: "createdBy";
    readonly options: {
        choices: Array<{
            id: string,
            email: string,
            name?: string,
            profilePicUrl?: string,
        }>,
    };
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface lastModifiedByField extends BaseField {
    readonly type: "lastModifiedBy";
    readonly options: {
        referencedFieldIds: Array<string>,
        choices: Array<{
            id: string,
            email: string,
            name?: string,
            profilePicUrl?: string,
        }>,
    };
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface externalSyncSourceField extends BaseField {
    readonly type: "externalSyncSource";
    readonly options: {
        choices: Array<{
            id: string,
            name: string,
            color?: string,
        }>,
    };
    updateOptionsAsync(options: never): Promise<void>;
}
declare interface aiTextField extends BaseField {
    readonly type: "aiText";
    readonly options: {
        prompt?: Array<string | {field: {fieldId: string}}>,
        referencedFieldIds?: Array<string>,
    };
    updateOptionsAsync(options: never): Promise<void>;
}
declare type Field = singleLineTextField | emailField | urlField | multilineTextField | numberField | percentField | currencyField | singleSelectField | multipleSelectsField | singleCollaboratorField | multipleCollaboratorsField | multipleRecordLinksField | dateField | dateTimeField | phoneNumberField | multipleAttachmentsField | checkboxField | formulaField | createdTimeField | rollupField | countField | multipleLookupValuesField | autoNumberField | barcodeField | ratingField | richTextField | durationField | lastModifiedTimeField | buttonField | createdByField | lastModifiedByField | externalSyncSourceField | aiTextField;
declare interface View {
    /**
     * The unique ID of this view.
     */
    readonly id: string;
    /**
     * The name of the view.
     */
    readonly name: string;
    /**
     * The type of the view, such as Grid, Calendar, or Kanban.
     */
    readonly type: "grid" | "form" | "calendar" | "gallery" | "kanban" | "timeline" | "levels" | "block";
    /**
     * The URL for the view. You can visit this URL in the browser to be taken to the view in the Airtable
     * UI.
     */
    readonly url: string;
    /**
     * Select records from the view. This action is asynchronous: you must add `await` before each call to this method.
     */
    selectRecordsAsync(options: {
        sorts?: ReadonlyArray<{
            field: Field | string;
            direction?: "asc" | "desc";
        }>;
        recordIds?: ReadonlyArray<string>;
        fields: ReadonlyArray<Field | string | null | undefined>;
    }): Promise<RecordQueryResult>;
    /**
     * 
     * Calling this method without passing `options.fields` is discouraged, but will
     *  be supported for now. Before this changes, we will post a potential deprecation
     *  timeline. Passing `options.fields` allows you to request just the fields you
     *  need, which will improve performance and reduce memory usage.
     * @deprecated
     */
    selectRecordsAsync(options?: {
        sorts?: ReadonlyArray<{
            field: Field | string;
            direction?: "asc" | "desc";
        }>;
        recordIds?: ReadonlyArray<string>;
        fields?: ReadonlyArray<Field | string | null | undefined>;
    }): Promise<RecordQueryResult>;
    /**
     * Select a single record from the view. This action is asynchronous: you must add `await` before each call to this method. If the specified record cannot be found, `null` will be returned.
     */
    selectRecordAsync(recordId: string, options?: {
        fields?: Array<Field | string | null | undefined>;
    }): Promise<AirtableRecord | null>;
}
declare interface Table {
    /**
     * The ID of this table.
     */
    readonly id: string;
    /**
     * The name of the table.
     */
    readonly name: string;
    /**
     * The description of this table, if it has one.
     */
    readonly description: string | null;
    /**
     * The URL for the table. You can visit this URL in the browser to be taken to the table in the
     * Airtable UI.
     */
    readonly url: string;
    /**
     * The fields in this table. The order is arbitrary, since fields are only ordered in the context of a
     * specific view.
     */
    readonly fields: ReadonlyArray<Field>;
    /**
     * The views in this table.
     */
    readonly views: ReadonlyArray<View>;
    /**
     * Get a field in the table according to its id or name.
     */
    getField(idOrName: string): Field;
    /**
     * Get a view in the table according to its id or name.
     */
    getView(idOrName: string): View;
    createFieldAsync<FieldTypeT extends "checkbox" | "singleSelect" | "multipleSelects" | "singleCollaborator" | "multipleCollaborators" | "number" | "percent" | "currency" | "duration" | "singleLineText" | "email" | "url" | "multilineText" | "phoneNumber" | "richText" | "barcode" | "multipleAttachments" | "date" | "dateTime" | "rating" | "multipleRecordLinks">(
                                name: string,
                                type: FieldTypeT,
                                ...args: FieldTypeT extends "number" | "percent" | "currency" | "singleSelect" | "multipleSelects" | "multipleRecordLinks" | "date" | "dateTime" | "checkbox" | "rating" | "duration" ? [
                                    options: FieldOptionsWriteFormat<FieldTypeT>,
                                    description?: string | null,
                                ] : [
                                    options?: null,
                                    description?: string | null,
                                ]
                            ): Promise<string>;
    /**
     * Select records from the table. This action is asynchronous: you must add `await` before each call to this method.
     */
    selectRecordsAsync(options: {
        sorts?: ReadonlyArray<{
            field: Field | string;
            direction?: "asc" | "desc";
        }>;
        recordIds?: ReadonlyArray<string>;
        fields: ReadonlyArray<Field | string | null | undefined>;
    }): Promise<RecordQueryResult>;
    /**
     * 
     * Calling this method without passing `options.fields` is discouraged, but will
     *  be supported for now. Before this changes, we will post a potential deprecation
     *  timeline. Passing `options.fields` allows you to request just the fields you
     *  need, which will improve performance and reduce memory usage.
     * @deprecated
     */
    selectRecordsAsync(options?: {
        sorts?: ReadonlyArray<{
            field: Field | string;
            direction?: "asc" | "desc";
        }>;
        recordIds?: ReadonlyArray<string>;
        fields?: ReadonlyArray<Field | string | null | undefined>;
    }): Promise<RecordQueryResult>;
    /**
     * Select a single record from the table. This action is asynchronous: you must add `await` before each call to this method. If the specified record cannot be found, `null` will be returned.
     */
    selectRecordAsync(recordId: string, options?: {
        fields?: Array<Field | string | null | undefined>;
    }): Promise<AirtableRecord | null>;
    /**
     * Creates multiple new records with the specified cell values. See cell values & field options
     * for the cell value format for each field type.
     * Throws an error if the user does not have permission to create the given records, or if invalid
     * input is provided (eg. invalid cell values).
     * You may only create up to 50 records in one call to `createRecordsAsync`.
     * This action is asynchronous: you must add `await` before each call to this method
     * to ensure it takes effect.
     */
    createRecordsAsync(records: ReadonlyArray<{fields: {[key: string]: unknown}}>): Promise<Array<string>>;
    /**
     * Updates cell values for multiple records. See cell values & field options for the cell value format
     * for each field type.
     * Throws an error if the user does not have permission to update the given cell values in the records,
     * or if invalid input is provided (eg. invalid cell values).
     * You may only update up to 50 records in one call to `updateRecordsAsync`.
     * This action is asynchronous: you must add `await` before each call to this method
     * to ensure it takes effect.
     */
    updateRecordsAsync(records: ReadonlyArray<{id: string; fields: {[key: string]: unknown}}>): Promise<void>;
    /**
     * Delete multiple records.
     * Throws an error if the user does not have permission to delete the given records.
     * You may only delete up to 50 records in one call to `deleteRecordsAsync`.
     * This action is asynchronous: you must add `await` before each call to this method
     * to ensure it takes effect.
     */
    deleteRecordsAsync(recordsOrRecordIds: ReadonlyArray<string | AirtableRecord>): Promise<void>;
    /**
     * Creates a new record with the specified cell values. See cell values & field options
     * for the cell value format for each field type.
     * Throws an error if the user does not have permission to create the given record, or if invalid
     * input is provided (eg. invalid cell values).
     * This action is asynchronous: you must add `await` before each call to this method
     * to ensure it takes effect.
     */
    createRecordAsync(fields: {[key: string]: unknown}): Promise<string>;
    /**
     * Updates cell values for a record. See cell values & field options for the cell value format
     * for each field type.
     * Throws an error if the user does not have permission to update the given cell values in the record,
     * or if invalid input is provided (eg. invalid cell values).
     * This action is asynchronous: you must add `await` before each call to this method
     * to ensure it takes effect.
     */
    updateRecordAsync(recordOrRecordId: AirtableRecord | string, fields: {[key: string]: unknown}): Promise<void>;
    /**
     * Delete a single record.
     * Throws an error if the user does not have permission to delete the given record.
     * This action is asynchronous: you must add `await` before each call to this method
     * to ensure it takes effect.
     */
    deleteRecordAsync(recordOrRecordId: AirtableRecord | string): Promise<void>;
}

declare interface Base {
    readonly id: string;
    readonly name: string;
    readonly activeCollaborators: ReadonlyArray<Collaborator>;
    readonly tables: ReadonlyArray<Table>;
    createTableAsync(name: string, fields: ReadonlyArray<{
        name: string;
        type: "checkbox" | "singleSelect" | "multipleSelects" | "singleCollaborator" | "multipleCollaborators" | "number" | "percent" | "currency" | "duration" | "singleLineText" | "email" | "url" | "multilineText" | "phoneNumber" | "richText" | "barcode" | "multipleAttachments" | "date" | "dateTime" | "rating" | "multipleRecordLinks";
        options?: {[key: string]: unknown} | null;
        description?: string | null;
    }>): Promise<string>;
    getCollaborator(idOrEmailOrName: string): Collaborator;
    getTable(idOrName: string): Table;
}
declare var base: Base;

declare var input: {
    config(): { [key: string]: unknown };
};
