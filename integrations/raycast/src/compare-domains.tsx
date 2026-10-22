import { Detail, LaunchProps } from '@raycast/api';
import { useEffect, useState } from 'react';
import { client, markdown } from './lib/client';

export default function Command(props: LaunchProps<{ arguments: { first: string; second: string } }>) {
	const [text, setText] = useState('Comparing…');
	const [loading, setLoading] = useState(true);
	useEffect(() => {
		client()
			.run('compare', { a: props.arguments.first, b: props.arguments.second })
			.then((c) => setText(markdown.compareMarkdown(c)))
			.catch((e: Error) => setText('# Could not compare\n\n' + e.message))
			.finally(() => setLoading(false));
	}, []);
	return <Detail isLoading={loading} markdown={text} />;
}
