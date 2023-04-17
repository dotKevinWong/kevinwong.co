import { Image } from '@chakra-ui/react';
import React from 'react';

interface EmojiProps {
    symbol: string;
    label?: string;
}

const Emoji = (props: EmojiProps) => (
    // <span
    //     className="emoji"
    //     role="img"
    //     aria-label={props.label ? props.label : ""}
    //     aria-hidden={props.label ? "false" : "true"}
    // >
        <Image src={`/emojis/${props.symbol}.png`} alt={props.label} boxSize="16px" marginRight={1}/>
);

export default Emoji;