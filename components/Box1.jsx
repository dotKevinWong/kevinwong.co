
import { Alert, AlertIcon, Box, Flex, Text } from "@chakra-ui/react";
import React, { useState } from "react";

export const Box1 = (props) => {
  const [diffX, setDiffX] = useState(0);
  const [diffY, setDiffY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [box, setBox] = useState({ left: props.left + '%', top: props.top + '%', position: 'absolute', zIndex: 1, textAlign: 'center' });

  const mouseStart = (e) => {
    setIsDragging(true);
    setDiffX(e.screenX - e.currentTarget.getBoundingClientRect().left);
    setDiffY(e.screenY - e.currentTarget.getBoundingClientRect().top);
  }

  const touchStart = (e) => {
    setDiffX(e.touches[0].screenX - e.currentTarget.getBoundingClientRect().left);
    setDiffY(e.touches[0].screenY - e.currentTarget.getBoundingClientRect().top);
    setIsDragging(true);
  };

  // take the dragging function and make it work for touch events
  const touchMove = (e) => {
    if (isDragging) {
      setBox({ left: (e.touches[0].screenX - diffX) / window.innerWidth * 100 + '%', top: (e.touches[0].screenY - diffY) / window.innerHeight * 100 + '%', position: 'absolute', zIndex: 1, textAlign: 'center' });
    }
  };

  const mouseMove = (e) => {
    if (isDragging) {
      setBox({
        // get the screen size and subtract the difference between the mouse and the box to get the new position in percentages

        // take the top pixels and find out what percentage of the screen it is
        top: (e.screenY - diffY) / window.innerHeight * 100 + '%',
        // take the left pixels and find out what percentage of the screen it is
        left: (e.screenX - diffX) / window.innerWidth * 100 + '%',
        position: 'absolute',
        zIndex: 1,
        textAlign: 'center'
      });
    }
  }

  const dragEnd = () => {
    setIsDragging(false);
  }

  return (
    <Box as="section" flex="1" p="6" marginTop="6" overflow="auto" onMouseMove={mouseMove} onTouchMove={touchMove}>
        <style jsx global>{`
        .gray_box {
            cursor: grab;
            width: 64px;
            height: 64px;
            background-image: url('/gray_folder.png');
            background-repeat: no-repeat;
            background-position: center;
            background-size: 64px 64px;
        }
        `}</style>
        <Box style={box}>
        <Box className="gray_box" onMouseDown={mouseStart} onMouseUp={dragEnd} onTouchStart={touchStart} onTouchEnd={dragEnd}></Box>
        <Text fontSize="xs" fontFamily="mono">{props.name}</Text>
        </Box>
    </Box>
  );
}