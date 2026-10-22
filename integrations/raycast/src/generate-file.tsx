import { Action, ActionPanel, Clipboard, Form, showToast, Toast } from '@raycast/api';
import { useState } from 'react';
import { client, markdown } from './lib/client';

export default function Command() {
	const [kind, setKind] = useState('robots.txt');
	async function submit(v: { allow: string; block: string; sitemap: string; name: string; description: string; page: string }) {
		const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
		try {
			const r = kind === 'robots.txt'
				? await client().run('robotsTxt', { allow: list(v.allow), block: list(v.block), sitemap: v.sitemap })
				: await client().run('llmsTxt', { name: v.name, description: v.description, pages: v.page ? [{ url: v.page.split('|')[0].trim(), description: (v.page.split('|')[1] || '').trim() }] : [] });
			const f = markdown.fileResult(r);
			await Clipboard.copy(f.text);
			await showToast({ style: Toast.Style.Success, title: 'Copied ' + kind, message: f.note || undefined });
		} catch (e) {
			await showToast({ style: Toast.Style.Failure, title: 'Could not generate', message: (e as Error).message });
		}
	}
	return (
		<Form actions={<ActionPanel><Action.SubmitForm title="Generate and Copy" onSubmit={submit} /></ActionPanel>}>
			<Form.Dropdown id="kind" title="File" value={kind} onChange={setKind}>
				<Form.Dropdown.Item value="robots.txt" title="robots.txt" />
				<Form.Dropdown.Item value="llms.txt" title="llms.txt" />
			</Form.Dropdown>
			{kind === 'robots.txt' ? (
				<>
					<Form.TextField id="allow" title="Allow" placeholder="GPTBot,ClaudeBot" />
					<Form.TextField id="block" title="Block" placeholder="Bytespider" />
					<Form.TextField id="sitemap" title="Sitemap URL" />
				</>
			) : (
				<>
					<Form.TextField id="name" title="Site Name" />
					<Form.TextField id="description" title="Description" />
					<Form.TextField id="page" title="Key Page" placeholder="https://example.com/pricing | Plans" />
				</>
			)}
			<Form.Description text="A free key gets a preview of the file. The full file needs a Pro, Fix or Beyond key." />
		</Form>
	);
}
