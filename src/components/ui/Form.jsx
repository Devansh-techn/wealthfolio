import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/** Label + control + hint/error wiring. `children` is a render-prop receiving the aria/id props. */
export function Field({ label, error, hint, required, children, className = '' }) {
  const id = useId();
  const descId = `${id}-d`;
  const props = { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error || hint ? descId : undefined, 'aria-required': required || undefined };
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children(props)}
      {(error || hint) && (
        <p id={descId} className={error ? 'field-error' : 'field-hint'} role={error ? 'alert' : undefined}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

export function TextField({ label, error, hint, className, required, ...input }) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(p) => <input className="input" {...p} {...input} />}
    </Field>
  );
}

/** Password input with a show/hide toggle. Same label/hint/error wiring as TextField; `type` is controlled here. */
export function PasswordField({ label, error, hint, className, required, ...input }) {
  const [shown, setShown] = useState(false);
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(p) => (
        <div className="input-wrap">
          <input className="input" {...p} {...input} type={shown ? 'text' : 'password'} />
          <button type="button" className="input-action" onClick={() => setShown((v) => !v)} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown}>
            {shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </div>
      )}
    </Field>
  );
}

export function SelectField({ label, error, hint, options, className, required, ...select }) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(p) => (
        <select className="input" {...p} {...select}>
          {options.map((o) => {
            const v = typeof o === 'string' ? { value: o, label: o } : o;
            return (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            );
          })}
        </select>
      )}
    </Field>
  );
}

export function TextAreaField({ label, error, hint, className, ...ta }) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {(p) => <textarea className="input" rows={3} {...p} {...ta} />}
    </Field>
  );
}

export function CheckField({ label, hint, ...input }) {
  const id = useId();
  return (
    <div className="field field-check">
      <input id={id} type="checkbox" {...input} />
      <label htmlFor={id}>{label}</label>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}
