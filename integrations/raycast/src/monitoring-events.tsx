import { Detail, List } from '@raycast/api';
import { useEffect, useState } from 'react';
import { client, markdown } from './lib/client';

type Ev = { id: string; type: string; domain: string; at: string; summary: string };

export default function Command() {
	const [events, setEvents] = useState<Ev[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	useEffect(() => {
		client()
			.run('events', { limit: 50 })
			.then((r) => setEvents(r.events))
			.catch((e: Error) => setError(e.message))
			.finally(() => setLoading(false));
	}, []);
	if (error) return <Detail markdown={'# Monitoring events\n\n' + error} />;
	return (
		<List isLoading={loading}>
			{events.map((e) => (
				<List.Item key={e.id} title={markdown.eventTitle(e)} subtitle={e.summary} accessories={[{ text: e.at.slice(0, 10) }]} />
			))}
		</List>
	);
}
