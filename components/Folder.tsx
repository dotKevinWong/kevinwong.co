import React, { useState, useEffect } from 'react'
import Draggable from 'react-draggable'
import { Box, Text, VStack, useBreakpointValue } from '@chakra-ui/react'

interface FolderProps {
    imageSrc: string
    title?: string
    size: number
    initialPosition: { x: number; y: number }
}

export const Folder = (props: FolderProps) => {
    const [position, setPosition] = useState({ x: 0, y: 0 })

    const onDragStop = (e: any, data: { x: any; y: any }) => {
      setPosition({ x: data.x, y: data.y })
    }
  
    const screenSize = useBreakpointValue({ base: 'xs', sm: 'sm', md: 'md', lg: 'lg', xl: 'xl' })
  
    useEffect(() => {
        const updatePosition = () => {
          const containerWidth = window.innerWidth
          const containerHeight = window.innerHeight
    
          setPosition({
            x: (containerWidth * props.initialPosition.x) / 100,
            y: (containerHeight * props.initialPosition.y) / 100,
          })
        }
    
        updatePosition()
        window.addEventListener('resize', updatePosition)
    
        return () => {
          window.removeEventListener('resize', updatePosition)
        }
      }, [props.initialPosition, screenSize])

    return (
        <Draggable position={position} onStop={onDragStop} bounds="parent">
            <VStack
                w={`${props.size}px`}
                h={`${props.size}px`}
                position="absolute"
                zIndex="1"
                borderRadius="md"
                align="center"
                role="group"
                outline="dashed 1px"
                _hover={{ cursor: 'grab' }}
            >
                <Box bgImage={props.imageSrc} w="100%" h="100%" bgPosition="center" bgSize={`${props.size/2}px`} bgRepeat="no-repeat" borderRadius="md" />
                <Text fontSize="xs" fontFamily="mono" _groupHover={{ textDecoration: 'underline' }}>
                    {props.title}
                </Text>
            </VStack>
        </Draggable>
    )
}

export default Folder