import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), route: { id: undefined as string | undefined }, get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ id: mocks.route.id }),
  useSearchParams: () => [new URLSearchParams()],
}));
vi.mock('../api/client', () => ({ dashboardApi: { get: mocks.get, post: mocks.post, put: mocks.put } }));
vi.mock('@uiw/react-md-editor', () => ({
  default: ({ value, onChange, textareaProps }: { value?: string; onChange: (value?: string) => void; textareaProps?: React.TextareaHTMLAttributes<HTMLTextAreaElement> }) => (
    <textarea {...textareaProps} value={value ?? ''} onChange={event => onChange(event.target.value)} />
  ),
}));
import { KnowledgeEditorPage } from '../pages/KnowledgeEditorPage';

beforeEach(() => {
  mocks.route.id = undefined;
  mocks.get.mockImplementation((path: string) => path === '/knowledge/categories' ? Promise.resolve([]) : Promise.resolve(path.endsWith('/content') ? { content: '' } : { title: '', category_id: '', tier: 'answer' }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });

it('names the navigation, title, category, tier and markdown controls and exposes validation to assistive technology', async () => {
  render(<KnowledgeEditorPage />);
  expect(screen.getByRole('button', { name: 'Back to knowledge base' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Title *' })).toBeRequired();
  expect(screen.getByRole('combobox', { name: 'Category' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Tier' })).toBeInTheDocument();
  const content = screen.getByRole('textbox', { name: 'Content (Markdown)' });
  fireEvent.click(screen.getByRole('button', { name: 'Save Article' }));
  const error = await screen.findByRole('alert');
  expect(error).toHaveTextContent('Title is required');
  expect(content).toHaveAttribute('aria-describedby', error.id);
});

it('prevents duplicate saves, retains the draft after failure, and retries the same payload', async () => {
  let reject!: (error: Error) => void;
  mocks.post.mockImplementationOnce(() => new Promise((_resolve, rejectSave) => { reject = rejectSave; })).mockResolvedValueOnce({});
  render(<React.StrictMode><KnowledgeEditorPage /></React.StrictMode>);
  fireEvent.change(screen.getByRole('textbox', { name: 'Title *' }), { target: { value: 'Keep this article' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Content (Markdown)' }), { target: { value: 'Retained content' } });
  const save = screen.getByRole('button', { name: 'Save Article' });
  fireEvent.click(save); fireEvent.click(save);
  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'Processing...' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Back to knowledge base' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Title *' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Content (Markdown)' })).toHaveAttribute('readonly');
  await act(async () => reject(new Error('synthetic save failure')));
  expect(await screen.findByRole('alert')).toHaveTextContent('synthetic save failure');
  expect(screen.getByRole('textbox', { name: 'Title *' })).toHaveValue('Keep this article');
  expect(screen.getByRole('textbox', { name: 'Content (Markdown)' })).toHaveValue('Retained content');
  fireEvent.click(screen.getByRole('button', { name: 'Save Article' }));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
  expect(mocks.post.mock.calls[1]).toEqual(['/knowledge/articles', { title: 'Keep this article', category_id: null, content: 'Retained content', tier: 'answer' }]);
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/knowledge'));
});

it('does not apply a stale article response after the route changes', async () => {
  const deferred = new Map<string, { promise: Promise<unknown>; resolve: (value: unknown) => void }>();
  const request = (path: string) => {
    if (path === '/knowledge/categories') return Promise.resolve([]);
    let resolve!: (value: unknown) => void;
    const promise = new Promise<unknown>(done => { resolve = done; });
    deferred.set(path, { promise, resolve });
    return promise;
  };
  mocks.get.mockImplementation(request);
  mocks.route.id = 'older';
  const view = render(<KnowledgeEditorPage />);
  await waitFor(() => expect(deferred.has('/knowledge/articles/older/content')).toBe(true));
  mocks.route.id = 'current'; view.rerender(<KnowledgeEditorPage />);
  await waitFor(() => expect(deferred.has('/knowledge/articles/current/content')).toBe(true));
  expect(screen.getByRole('button', { name: 'Save Article' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Back to knowledge base' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Title *' })).toBeDisabled();
  await act(async () => {
    deferred.get('/knowledge/articles/older')!.resolve({ title: 'Stale title', category_id: '', tier: 'answer' });
    deferred.get('/knowledge/articles/older/content')!.resolve({ content: 'stale' });
  });
  expect(screen.getByRole('textbox', { name: 'Title *' })).not.toHaveValue('Stale title');
  expect(screen.getByRole('button', { name: 'Save Article' })).toBeDisabled();
  await act(async () => {
    deferred.get('/knowledge/articles/current')!.resolve({ title: 'Current title', category_id: '', tier: 'sop' });
    deferred.get('/knowledge/articles/current/content')!.resolve({ content: 'current' });
  });
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Title *' })).toHaveValue('Current title'));
  expect(screen.getByRole('textbox', { name: 'Content (Markdown)' })).toHaveValue('current');
  expect(screen.getByRole('button', { name: 'Save Article' })).toBeEnabled();
});

it('does not navigate when an old save resolves after the route changes', async () => {
  let resolve!: (value: unknown) => void;
  mocks.post.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = render(<KnowledgeEditorPage />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Title *' }), { target: { value: 'Old route article' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Article' }));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
  mocks.route.id = 'new-route';
  view.rerender(<KnowledgeEditorPage />);
  await act(async () => {});
  await act(async () => resolve({}));
  expect(mocks.navigate).not.toHaveBeenCalled();
});
