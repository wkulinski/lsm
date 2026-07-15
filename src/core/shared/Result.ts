export type Result<SuccessFields extends object, FailureFields extends object = { error: string }>
    = | ({ ok: true } & SuccessFields)
        | ({ ok: false } & FailureFields);
