import { Detail, LaunchProps } from '@raycast/api';
import { useEffect, useState } from 'react';
import { client, markdown } from './lib/client';

export default function Command(props: LaunchProps<{ arguments: { domain: string } }>) {
	const [text, setText] = useState('Scanning…');
	const [loading, setLoading] = useState(true);
	useEffect(() => {
		client()
			.run('scan', { domain: props.arguments.domain })
			.then((s) => setText(markdown.scanMarkdown(s)))
			.catch((e: Error) => setText('# Could not scan\n\n' + e.message))
			.finally(() => setLoading(false));
	}, []);
	return <Detail isLoading={loading} markdown={text} />;
}
