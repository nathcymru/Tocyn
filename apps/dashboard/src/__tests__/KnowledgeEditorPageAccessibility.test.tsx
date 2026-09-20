import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), route: { id: undefined as string | undefined }, get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ id: mocks.route.id }),
  useSearchParams: () => [new URLSearchParams()],
}));
vi.mock('../api/client', () => ({ dashboardApi: { get: mocks.get, post: mocks.post, put: mocks.put } }));

import { KnowledgeEditorPage } from '../pages/KnowledgeEditorPage';

async function setEditorText(value: string) {
  const editor = screen.getByRole('textbox', { name: 'Content (Markdown)' });
  editor.focus();
  await userEvent.clear(editor);
  await userEvent.type(editor, value, { skipClick: true });
}

beforeEach(() => {
  mocks.route.id = undefined;
  mocks.get.mockImplementation((path: string) => path === '/knowledge/categories' ? Promise.resolve([]) : Promise.resolve(path.endsWith('/content') ? { content: '' } : { title: '', category_id: '', tier: 'answer' }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });

it('names the navigation, title, category, tier and markdown controls and exposes validation to assistive technology', async () => {
  render(<KnowledgeEditorPage />);
  expect(screen.getByRole('button', { name: 'Back to knowledge base' })).toBeInTheDocument();
  const title = screen.getByRole('textbox', { name: 'Title' });
  expect(title).toBeRequired();
  const titleField = title.closest('[data-scope="field"][data-part="root"]');
  expect(titleField).toHaveClass('field__root');
  expect(titleField?.querySelector('[data-scope="field"][data-part="label"]')).toHaveAttribute('for', title.id);
  expect(titleField?.querySelector('[data-scope="field"][data-part="required-indicator"]')).toHaveTextContent('*');
  for (const name of ['Category', 'Tier']) {
    const select = screen.getByRole('combobox', { name }).closest('[data-scope="select"][data-part="root"]');
    expect(select).toHaveClass('select__root');
    expect(select?.querySelector('[data-scope="select"][data-part="label"]')).toHaveClass('select__label');
    expect(select?.querySelector('[data-scope="select"][data-part="label"]')).toHaveTextContent(name);
  }
  const content = screen.getByRole('textbox', { name: 'Content (Markdown)' });
  const contentField = content.closest('[data-scope="field"][data-part="root"]');
  expect(contentField).toHaveClass('field__root');
  expect(contentField?.querySelector('[data-scope="field"][data-part="label"]')).toHaveAttribute('for', content.id);
  expect(content).toHaveAttribute('aria-labelledby', `${content.id}-label`);
  fireEvent.click(screen.getByRole('button', { name: 'Save Article' }));
  const error = await screen.findByRole('alert');
  expect(error).toHaveTextContent('Article needs a title');
  expect(error).toHaveTextContent('Title is required');
  expect(content).toHaveAttribute('aria-describedby', error.id);
});

it('prevents duplicate saves, retains the draft after failure, and retries the same payload', async () => {
  let reject!: (error: Error) => void;
  mocks.post.mockImplementationOnce(() => new Promise((_resolve, rejectSave) => { reject = rejectSave; })).mockResolvedValueOnce({});
  render(<React.StrictMode><KnowledgeEditorPage /></React.StrictMode>);
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Keep this article' } });
  await setEditorText('Retained content');
  const save = screen.getByRole('button', { name: 'Save Article' });
  fireEvent.click(save); fireEvent.click(save);
  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'Processing...' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Back to knowledge base' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Title' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Content (Markdown)' })).toHaveAttribute('contenteditable', 'false');
  await act(async () => reject(new Error('synthetic save failure')));
  const saveError = await screen.findByRole('alert');
  expect(saveError).toHaveTextContent('Article could not be saved');
  expect(saveError).toHaveTextContent('synthetic save failure');
  expect(saveError).not.toHaveTextContent('editor unavailable');
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Keep this article');
  expect(screen.getByRole('textbox', { name: 'Content (Markdown)' })).toHaveTextContent('Retained content');
  expect(screen.getByRole('textbox', { name: 'Content (Markdown)' })).toHaveAttribute('contenteditable', 'true');
  expect(screen.getByRole('button', { name: 'Save Article' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save Article' }));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
  expect(mocks.post.mock.calls[1]).toEqual(['/knowledge/articles', { title: 'Keep this article', category_id: null, content: 'Retained content', tier: 'answer' }]);
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/knowledge'));
});

it('labels a category-read failure honestly without disabling the editor', async () => {
  mocks.get.mockRejectedValueOnce(new Error('Synthetic categories unavailable')).mockResolvedValueOnce([
    { id: 'recovered-category', name: 'Recovered category', parent_id: null, created_at: '2026-01-01T00:00:00Z' },
  ]);
  render(<KnowledgeEditorPage />);
  const error = await screen.findByRole('alert');
  expect(error).toHaveTextContent('Categories could not be loaded');
  expect(error).toHaveTextContent('Synthetic categories unavailable');
  expect(screen.getByRole('textbox', { name: 'Content (Markdown)' })).toHaveAttribute('contenteditable', 'true');
  expect(screen.getByRole('button', { name: 'Save Article' })).toBeEnabled();
  await setEditorText('Preserved category retry draft');
  fireEvent.click(screen.getByRole('button', { name: 'Retry categories' }));
  await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Content (Markdown)' })).toHaveTextContent('Preserved category retry draft');
  await userEvent.click(screen.getByRole('combobox', { name: 'Category' }));
  expect(await screen.findByRole('option', { name: 'Recovered category' })).toBeInTheDocument();
});

it('keeps article Retry visible when categories fail later, then reveals category Retry after article recovery', async () => {
  mocks.route.id = 'article-a';
  let rejectCategories!: (error: Error) => void;
  const firstCategoryRead = new Promise<never>((_resolve, reject) => { rejectCategories = reject; });
  let categoryReads = 0;
  let articleReads = 0;
  mocks.get.mockImplementation((path: string) => {
    if (path === '/knowledge/categories') {
      categoryReads += 1;
      return categoryReads === 1 ? firstCategoryRead : Promise.resolve([
        { id: 'recovered-category', name: 'Recovered category', parent_id: null, created_at: '2026-01-01T00:00:00Z' },
      ]);
    }
    articleReads += 1;
    if (articleReads <= 2) return Promise.reject(new Error('Synthetic article unavailable'));
    return Promise.resolve(path.endsWith('/content')
      ? { content: 'Recovered article body' }
      : { title: 'Recovered article', category_id: '', tier: 'answer' });
  });
  render(<KnowledgeEditorPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Article could not be loaded');
  await act(async () => rejectCategories(new Error('Synthetic categories unavailable')));
  expect(screen.getByRole('alert')).toHaveTextContent('Synthetic article unavailable');
  expect(screen.getByRole('button', { name: 'Retry article' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Retry categories' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry article' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Recovered article'));
  expect(screen.getByRole('alert')).toHaveTextContent('Categories could not be loaded');
  expect(screen.getByRole('button', { name: 'Retry categories' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Save Article' })).toBeEnabled();
  expect(screen.getByRole('textbox', { name: 'Content (Markdown)' })).toHaveTextContent('Recovered article body');
  fireEvent.click(screen.getByRole('button', { name: 'Retry categories' }));
  await waitFor(() => expect(categoryReads).toBe(2));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Content (Markdown)' })).toHaveTextContent('Recovered article body');
});

it('keeps the article loading skeleton visible if categories fail first', async () => {
  mocks.route.id = 'article-a';
  mocks.get.mockImplementation((path: string) => path === '/knowledge/categories'
    ? Promise.reject(new Error('Synthetic categories unavailable'))
    : new Promise(() => {}));
  render(<KnowledgeEditorPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Categories could not be loaded');
  expect(screen.getByRole('status', { name: 'Loading article' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Article' })).toBeDisabled();
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
  expect(screen.getByRole('textbox', { name: 'Title' })).toBeDisabled();
  await act(async () => {
    deferred.get('/knowledge/articles/older')!.resolve({ title: 'Stale title', category_id: '', tier: 'answer' });
    deferred.get('/knowledge/articles/older/content')!.resolve({ content: 'stale' });
  });
  expect(screen.getByRole('textbox', { name: 'Title' })).not.toHaveValue('Stale title');
  expect(screen.getByRole('button', { name: 'Save Article' })).toBeDisabled();
  await act(async () => {
    deferred.get('/knowledge/articles/current')!.resolve({ title: 'Current title', category_id: '', tier: 'sop' });
    deferred.get('/knowledge/articles/current/content')!.resolve({ content: 'current' });
  });
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Current title'));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Content (Markdown)' })).toHaveTextContent('current'));
  expect(screen.getByRole('button', { name: 'Save Article' })).toBeEnabled();
});

it('shows a loading skeleton and retries a failed article read without enabling a blank editor', async () => {
  mocks.route.id = 'article-a';
  let contentReads = 0;
  mocks.get.mockImplementation((path: string) => {
    if (path === '/knowledge/categories') return Promise.resolve([]);
    if (path.endsWith('/content')) {
      contentReads += 1;
      return contentReads === 1 ? Promise.reject(new Error('Synthetic read failure')) : Promise.resolve({ content: 'Recovered article content' });
    }
    return Promise.resolve({ title: 'Recovered article', category_id: '', tier: 'answer' });
  });
  render(<KnowledgeEditorPage />);
  expect(screen.getByRole('status', { name: 'Loading article' })).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic read failure');
  expect(screen.getByRole('alert')).toHaveTextContent('Article could not be loaded');
  expect(screen.getByRole('button', { name: 'Save Article' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry article' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Recovered article'));
  expect(screen.getByRole('textbox', { name: 'Content (Markdown)' })).toHaveTextContent('Recovered article content');
  expect(screen.getByRole('button', { name: 'Save Article' })).toBeEnabled();
});

it('does not navigate when an old save resolves after the route changes', async () => {
  let resolve!: (value: unknown) => void;
  mocks.post.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = render(<KnowledgeEditorPage />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Old route article' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Article' }));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
  mocks.route.id = 'new-route';
  view.rerender(<KnowledgeEditorPage />);
  await act(async () => {});
  await act(async () => resolve({}));
  expect(mocks.navigate).not.toHaveBeenCalled();
});
