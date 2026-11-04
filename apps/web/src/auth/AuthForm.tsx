import { useState } from 'react';
import type { FormEvent, InputHTMLAttributes } from 'react';
import { z, type ZodType } from 'zod';
import { loginSchema, registerSchema } from '@taskflow/shared';
import { ApiRequestError } from '../api/client';
import { useAuth } from './AuthProvider';

type Mode = 'login' | 'register';
type FieldErrors = Record<string, string[] | undefined>;

/**
 * Renders the sign-in / sign-up form, validating with the shared Zod schemas before calling the API.
 * @since REQ-002
 */
export function AuthForm() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Parses data with the schema, showing field errors and returning null when it is invalid.
   * @since REQ-002
   */
  function validate<T>(schema: ZodType<T>, data: unknown): T | null {
    const parsed = schema.safeParse(data);
    setFieldErrors(parsed.success ? {} : z.flattenError(parsed.error).fieldErrors);
    return parsed.success ? parsed.data : null;
  }

  /**
   * Validates the form data and submits it to login or register.
   * @since REQ-002
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const loginInput = mode === 'login' ? validate(loginSchema, data) : null;
    const registerInput = mode === 'register' ? validate(registerSchema, data) : null;
    if (!loginInput && !registerInput) return;

    setSubmitting(true);
    try {
      if (loginInput) await auth.login(loginInput);
      else if (registerInput) await auth.register(registerInput);
    } catch (error) {
      if (error instanceof ApiRequestError && error.body?.errors) setFieldErrors(error.body.errors);
      setFormError(error instanceof Error ? error.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card">
      <h2>{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
      <form className="form" onSubmit={handleSubmit} noValidate key={mode}>
        {mode === 'register' && (
          <Field label="Name" name="name" autoComplete="name" errors={fieldErrors['name']} />
        )}
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          errors={fieldErrors['email']}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          errors={fieldErrors['password']}
        />
        {formError && <p className="down">{formError}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <button
        type="button"
        className="link"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setFieldErrors({});
          setFormError(null);
        }}
      >
        {mode === 'login' ? 'No account? Create one' : 'Already have an account? Sign in'}
      </button>
    </section>
  );
}

/**
 * Renders a labelled input with its validation errors.
 * @since REQ-002
 */
function Field({
  label,
  errors,
  ...input
}: { label: string; errors?: string[] } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...input} aria-invalid={errors ? true : undefined} />
      {errors?.map((message) => (
        <small key={message} className="down">
          {message}
        </small>
      ))}
    </label>
  );
}
